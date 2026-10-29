import {test} from 'node:test';
import assert from 'node:assert/strict';

import {base64UrlFromString, stringFromBase64Url, timingSafeEqual} from '../lib/auth/crypto';
import {isAdminEmail, parseAdminEmails} from '../lib/auth/env';
import {AuthError} from '../lib/auth/errors';
import {roleForLogin, signInWithGoogleProfile} from '../lib/auth/login';
import {exchangeGoogleCode, signOAuthState, verifyOAuthState, type OAuthStatePayload} from '../lib/auth/oauth';
import {hashSessionToken, resolveSession, sessionCookieOptions, SESSION_TTL_MS} from '../lib/auth/session';
import type {AuthStore, AuthSession, AuthUser, NewAuthUser} from '../lib/auth/store';
import {loginPathFor, requestOrigin, safeReturnTo} from '../lib/auth/urls';

function createFakeStore() {
 const users = new Map<string, AuthUser>();
 const accounts: {provider: string; providerAccountId: string; userId: string}[] = [];
 const sessions = new Map<string, AuthSession>();
 const store: AuthStore = {
  async findUserByEmail(email) { return [...users.values()].find(user => user.email === email) ?? null; },
  async findUserById(id) { return users.get(id) ?? null; },
  async insertUser(user: NewAuthUser) { if ([...users.values()].some(existing => existing.email === user.email)) return; users.set(user.id, {...user}); },
  async promoteUser(id) { const user = users.get(id); if (user) users.set(id, {...user, role: 'ADMIN'}); },
  async updateUserProfile(id, profile) {
   const user = users.get(id);
   if (!user) return;
   if (profile.name !== null) user.name = profile.name;
   if (profile.image !== null) user.image = profile.image;
  },
  async linkAccount(account) {
   if (!accounts.some(existing => existing.provider === account.provider && existing.providerAccountId === account.providerAccountId)) {
    accounts.push({provider: account.provider, providerAccountId: account.providerAccountId, userId: account.userId});
   }
  },
  async insertSession(session) { sessions.set(session.id, {...session}); },
  async findSession(id) { return sessions.get(id) ?? null; },
  async deleteSession(id) { sessions.delete(id); },
  async deleteExpiredSessions(now) { for (const [id, session] of sessions) if (session.expiresAt.getTime() <= now.getTime()) sessions.delete(id); },
 };
 return {store, users, accounts, sessions};
}

const profile = {providerAccountId: 'google-42', email: 'Sara@Example.com', name: 'سارة', image: 'https://img.example/sara.png'};
const now = new Date('2026-01-01T00:00:00.000Z');

test('roles are resolved server-side from ADMIN_EMAILS only', () => {
 assert.deepEqual(parseAdminEmails(' Admin@Example.com , teacher@example.com ,,'), ['admin@example.com', 'teacher@example.com']);
 assert.deepEqual(parseAdminEmails(undefined), []);
 assert.equal(isAdminEmail('ADMIN@example.com', ['admin@example.com']), true);
 assert.equal(isAdminEmail('student@example.com', ['admin@example.com']), false);
 assert.equal(roleForLogin(null, true), 'ADMIN');
 assert.equal(roleForLogin(null, false), 'STUDENT');
 assert.equal(roleForLogin('STUDENT', true), 'ADMIN');
 assert.equal(roleForLogin('ADMIN', false), 'ADMIN');
});

test('first Google login creates the user, links the account and stores only a hashed session token', async () => {
 const {store, users, accounts, sessions} = createFakeStore();
 const result = await signInWithGoogleProfile(profile, {store, authSecret: 'test-secret', adminEmails: [], now});
 assert.equal(result.user.role, 'STUDENT');
 assert.equal(result.user.email, 'sara@example.com');
 assert.equal(result.user.name, 'سارة');
 assert.equal(users.size, 1);
 assert.equal(accounts.length, 1);
 assert.equal(accounts[0].provider, 'google');
 assert.equal(sessions.size, 1);
 const storedId = [...sessions.keys()][0];
 assert.notEqual(storedId, result.token);
 assert.equal(storedId, await hashSessionToken(result.token, 'test-secret'));
 assert.equal(result.expiresAt.getTime(), now.getTime() + SESSION_TTL_MS);
});

test('ADMIN_EMAILS grants ADMIN on first login and never lets a later login downgrade it', async () => {
 const {store} = createFakeStore();
 const admin = await signInWithGoogleProfile({...profile, email: 'Admin@Example.com'}, {store, authSecret: 'test-secret', adminEmails: ['admin@example.com'], now});
 assert.equal(admin.user.role, 'ADMIN');
 const returning = await signInWithGoogleProfile({...profile, email: 'admin@example.com'}, {store, authSecret: 'test-secret', adminEmails: [], now});
 assert.equal(returning.user.role, 'ADMIN');
 assert.equal(returning.user.id, admin.user.id);
});

test('returning login reuses the user and links the Google account exactly once', async () => {
 const {store, users, accounts} = createFakeStore();
 const first = await signInWithGoogleProfile(profile, {store, authSecret: 'test-secret', adminEmails: [], now});
 const second = await signInWithGoogleProfile({...profile, name: 'سارة أحمد'}, {store, authSecret: 'test-secret', adminEmails: [], now});
 assert.equal(first.user.id, second.user.id);
 assert.equal(users.size, 1);
 assert.equal(accounts.length, 1);
 assert.equal(second.user.name, 'سارة أحمد');
});

test('session validation requires the raw cookie token and rejects expired sessions', async () => {
 const {store} = createFakeStore();
 const {token, user} = await signInWithGoogleProfile(profile, {store, authSecret: 'test-secret', adminEmails: [], now});
 assert.equal((await resolveSession(store, token, 'test-secret', now))?.id, user.id);
 assert.equal(await resolveSession(store, token, 'wrong-secret', now), null);
 assert.equal(await resolveSession(store, 'not-a-real-token', 'test-secret', now), null);
 assert.equal(await resolveSession(store, '', 'test-secret', now), null);
 const expired = new Date(now.getTime() + SESSION_TTL_MS + 1000);
 assert.equal(await resolveSession(store, token, 'test-secret', expired), null);
 assert.equal(await resolveSession(store, token, 'test-secret', now), null);
});

test('session cookie is httpOnly, lax, path-bound and secure only in production', () => {
 assert.deepEqual(sessionCookieOptions(true), {httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: SESSION_TTL_MS / 1000});
 assert.equal(sessionCookieOptions(false).secure, false);
});

test('OAuth state is HMAC signed, expiring and tamper evident', async () => {
 const payload: OAuthStatePayload = {state: 'state-1', verifier: 'verifier-1', returnTo: '/app', exp: now.getTime() + 60_000};
 const signed = await signOAuthState(payload, 'state-secret');
 assert.deepEqual(await verifyOAuthState(signed, 'state-secret'), payload);
 assert.equal(await verifyOAuthState(signed, 'other-secret'), null);
 assert.equal(await verifyOAuthState('not-a-token', 'state-secret'), null);
 assert.equal(await verifyOAuthState(`${signed}.extra`, 'state-secret'), null);
 const tampered = `${base64UrlFromString(JSON.stringify({...payload, returnTo: 'https://evil.example'}))}.${signed.split('.')[1]}`;
 assert.equal(await verifyOAuthState(tampered, 'state-secret'), null);
 assert.equal(stringFromBase64Url(signed.split('.')[0]), JSON.stringify(payload));
});

test('Google code exchange is server-to-server, verifies the email and never returns tokens', async () => {
 const calls: {url: string; init?: RequestInit}[] = [];
 const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push({url, init});
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({access_token: 'server-only-token', id_token: 'id-token'});
  if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({sub: '42', email: 'Sara@Example.com', email_verified: true, name: 'سارة', picture: 'https://img.example/sara.png'});
  return new Response('not found', {status: 404});
 }) as typeof fetch;

 const result = await exchangeGoogleCode({code: 'auth-code', codeVerifier: 'verifier', clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'https://app.local/api/auth/google/callback', fetchImpl});
 assert.deepEqual(result, {providerAccountId: '42', email: 'sara@example.com', name: 'سارة', image: 'https://img.example/sara.png'});
 assert.equal('access_token' in result, false);

 const tokenCall = calls[0];
 assert.equal(tokenCall.url, 'https://oauth2.googleapis.com/token');
 assert.equal(tokenCall.init?.method, 'POST');
 assert.doesNotMatch(tokenCall.url, /client-secret/);
 const body = String(tokenCall.init?.body);
 assert.match(body, /client_secret=client-secret/);
 assert.match(body, /code_verifier=verifier/);
 assert.equal(calls[1].url, 'https://openidconnect.googleapis.com/v1/userinfo');
});

test('unverified or failed Google responses are rejected with generic auth errors', async () => {
 const unverified = (async (input: RequestInfo | URL) =>
  String(input).includes('oauth2') ? Response.json({access_token: 'token'}) : Response.json({sub: '1', email: 'x@example.com', email_verified: false})) as typeof fetch;
 await assert.rejects(
  exchangeGoogleCode({code: 'c', codeVerifier: 'v', clientId: 'id', clientSecret: 'secret', redirectUri: 'https://app.local/cb', fetchImpl: unverified}),
  (error: unknown) => error instanceof AuthError && error.code === 'email_unverified',
 );
 const failed = (async () => new Response('denied', {status: 400})) as typeof fetch;
 await assert.rejects(
  exchangeGoogleCode({code: 'c', codeVerifier: 'v', clientId: 'id', clientSecret: 'secret', redirectUri: 'https://app.local/cb', fetchImpl: failed}),
  (error: unknown) => error instanceof AuthError && error.code === 'oauth_exchange_failed',
 );
});

test('returnTo only accepts same-origin relative paths', () => {
 assert.equal(safeReturnTo('/app'), '/app');
 assert.equal(safeReturnTo('/app?tab=1#top'), '/app?tab=1#top');
 assert.equal(safeReturnTo('//evil.example'), '/app');
 assert.equal(safeReturnTo('https://evil.example'), '/app');
 assert.equal(safeReturnTo('/\\evil.example'), '/app');
 assert.equal(safeReturnTo(null), '/app');
 assert.equal(safeReturnTo(''), '/app');
 assert.equal(loginPathFor('/app'), '/login?returnTo=%2Fapp');
});

test('request origin follows the proxy scheme and ignores the forwarded host', () => {
 const proxied = new Request('http://internal:3000/api/auth/google', {headers: {host: 'fahimni.app', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example'}});
 assert.equal(requestOrigin(proxied), 'https://fahimni.app');
 const local = new Request('http://localhost:5173/api/auth/google', {headers: {host: 'localhost:5173'}});
 assert.equal(requestOrigin(local), 'http://localhost:5173');
});

test('timing safe comparison and base64url helpers round-trip', () => {
 assert.equal(timingSafeEqual('abc', 'abc'), true);
 assert.equal(timingSafeEqual('abc', 'abd'), false);
 assert.equal(timingSafeEqual('abc', 'abcd'), false);
 const text = 'فهمني /app?x=1';
 assert.equal(stringFromBase64Url(base64UrlFromString(text)), text);
});
