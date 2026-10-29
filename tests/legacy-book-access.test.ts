import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'legacy-book-test-secret';
process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

import type { AuthUser } from '../lib/auth/store';
import type { AuthSession, AuthStore } from '../lib/auth/store';

const admin: AuthUser = { id: 'admin-1', email: 'admin@example.com', name: 'مشرف', image: null, role: 'ADMIN' };
const student: AuthUser = { id: 'student-1', email: 'student@example.com', name: 'طالب', image: null, role: 'STUDENT' };

// Next.js declares process.env.NODE_ENV as readonly. Tests need to flip it to
// exercise the development-only guards, so write through a mutable view.
const mutableEnv = process.env as unknown as Record<string, string | undefined>;
function setNodeEnv(value: string | undefined): void {
  if (value === undefined) delete mutableEnv.NODE_ENV;
  else mutableEnv.NODE_ENV = value;
}

async function installSession(user: AuthUser | null, token: string, secret: string) {
  const { hashSessionToken } = await import('../lib/auth/session');
  const { setAuthStoreForTests } = await import('../lib/auth/store');
  const sessionId = await hashSessionToken(token, secret);
  const unused = async () => { throw new Error('not used'); };
  const store: AuthStore = {
    findUserByEmail: unused,
    findUserById: async (id) => (user && id === user.id ? user : null),
    insertUser: unused,
    promoteUser: unused,
    updateUserProfile: unused,
    linkAccount: unused,
    insertSession: unused,
    findSession: async (id): Promise<AuthSession | null> =>
      user && id === sessionId ? { id, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) } : null,
    deleteSession: unused,
    deleteExpiredSessions: unused,
  };
  setAuthStoreForTests(store);
}

after(() => {
  setNodeEnv('test');
});

/* ---------------------- /api/book legacy excerpt endpoint --------------------- */

test('legacy excerpt endpoint refuses anonymous callers', async () => {
  const previous = process.env.NODE_ENV;
  setNodeEnv('development');
  try {
    const { GET } = await import('../app/api/book/route');
    const anonymous = await GET(new Request('https://local/api/book?q=معادلة'));
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.text()).includes('excerpt'), false);
  } finally {
    setNodeEnv(previous);
  }
});

test('legacy excerpt endpoint is development-only: a signed-in student is served in dev, 404 in production', async () => {
  const previous = process.env.NODE_ENV;
  try {
    // Development: an authenticated caller still receives excerpts.
    setNodeEnv('development');
    await installSession(student, 'dev-token', 'legacy-book-test-secret');
    const { GET } = await import('../app/api/book/route');
    const dev = await GET(new Request('https://local/api/book?q=حل معادلة', { headers: { cookie: 'fahimni_session=dev-token' } }));
    assert.equal(dev.status, 200);
    const body = await dev.json() as { results: unknown[] };
    assert.ok(Array.isArray(body.results));

    // Production: the legacy surface is closed regardless of session or role, so
    // a signed-in student (and an admin) cannot read protected excerpts.
    setNodeEnv('production');
    const studentProd = await GET(new Request('https://local/api/book?q=حل معادلة', { headers: { cookie: 'fahimni_session=dev-token' } }));
    assert.equal(studentProd.status, 404);
    assert.equal((await studentProd.text()).includes('excerpt'), false);
    assert.equal((await GET(new Request('https://local/api/book?q=حل معادلة'))).status, 404);

    await installSession(admin, 'prod-admin-token', 'legacy-book-test-secret');
    const adminProd = await GET(new Request('https://local/api/book?q=حل معادلة', { headers: { cookie: 'fahimni_session=prod-admin-token' } }));
    assert.equal(adminProd.status, 404);
  } finally {
    setNodeEnv(previous);
  }
});

/* --------------------- /book/<n>.jpg legacy page image route ------------------ */

test('legacy page images are not public: 404 in production, served with no-store in development', async () => {
  const previous = process.env.NODE_ENV;
  try {
    const { GET } = await import('../app/book/[name]/route');

    setNodeEnv('production');
    // Every caller, including an authenticated admin, is refused in production.
    await installSession(admin, 'img-admin-token', 'legacy-book-test-secret');
    const prod = await GET(new Request('https://local/book/10.jpg', { headers: { cookie: 'fahimni_session=img-admin-token' } }), { params: Promise.resolve({ name: '10.jpg' }) });
    assert.equal(prod.status, 404);

    setNodeEnv('development');
    const dev = await GET(new Request('https://local/book/10.jpg'), { params: Promise.resolve({ name: '10.jpg' }) });
    assert.equal(dev.status, 200);
    assert.equal(dev.headers.get('content-type'), 'image/jpeg');
    assert.equal(dev.headers.get('cache-control'), 'no-store');
    assert.ok((await dev.arrayBuffer()).byteLength > 0);
  } finally {
    setNodeEnv(previous);
  }
});

test('legacy page image route rejects traversal and non-numeric names', async () => {
  const previous = process.env.NODE_ENV;
  setNodeEnv('development');
  try {
    const { GET } = await import('../app/book/[name]/route');
    for (const name of ['../../etc/passwd', '10.jpg/../5.jpg', 'abc.jpg', '10.png', '10.jpg.exe', '../legacy-textbook/10.jpg']) {
      const response = await GET(new Request(`https://local/book/${encodeURIComponent(name)}`), { params: Promise.resolve({ name }) });
      assert.equal(response.status, 404, `expected 404 for ${name}`);
    }
  } finally {
    setNodeEnv(previous);
  }
});
