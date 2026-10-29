# Phase 7 — fahimni.me + Google OAuth readiness (configuration plan, NOT executed)

Status: prepared only. No DNS record, no certificate and no Google setting was
changed. Google production sign-in is **NOT verified** until a real request on
the deployed domain succeeds.

## 1) DNS records required (owner action, later)

| Type | Name | Value | Purpose |
| --- | --- | --- | --- |
| A | `fahimni.me` | VPS IPv4 (owner knows it) | main site |
| A | `www.fahimni.me` | same IPv4 | www → redirect to apex (nginx) |
| CNAME | `staging.fahimni.me` | `fahimni.me` | isolated staging (basic auth + noindex) |

No AAAA unless the VPS has IPv6. TTL 300 during setup. Do not touch other
records (mail, verification) on the domain.

## 2) HTTPS

- nginx (already on the VPS) terminates TLS; the app stays on `127.0.0.1:3100`
  (prod) / `3101` (staging) — never exposed directly.
- Certificates: Let's Encrypt via certbot, one cert per hostname
  (`fahimni.me`, `www.fahimni.me`, `staging.fahimni.me`).
- Redirect `http → https`, `www → apex`; HSTS at the proxy
  (`Strict-Transport-Security: max-age=31536000; includeSubDomains` after the
  first successful renewal).
- Staging: `auth_basic` + `X-Robots-Tag: noindex, nofollow` + robots.txt deny.
- Proxy headers must forward `Host` and `X-Forwarded-Proto` (the app's CSRF
  origin check reconstructs the browser origin from `Host` + scheme).

## 3) Google OAuth (Google Cloud Console)

- Authorized JavaScript origins: `https://fahimni.me` (add
  `https://www.fahimni.me` only if www is kept as a separate origin; the
  redirect below uses the apex).
- Authorized redirect URI: `https://fahimni.me/api/auth/google/callback`
  (staging adds `https://staging.fahimni.me/api/auth/google/callback`).
- Scopes: `openid`, `email`, `profile` only — nothing else.
- OAuth consent screen: app name «فهمني», support email, logo, privacy policy
  `https://fahimni.me/privacy` and terms `https://fahimni.me/terms`
  (both still marked «مسودة» until legal review — Google review may reject a
  draft-marked policy page; resolve before submission).
- Publish the consent screen to production before onboarding real students;
  while in «Testing», only test users can sign in.
- The app validates the signed `state` (HMAC + PKCE verifier in an HttpOnly
  cookie) — no additional console setting is needed for that.

## 4) Application environment for the domain

Required additions on the server (`deploy/env.production`):

```
NEXT_PUBLIC_SITE_URL=https://fahimni.me
GOOGLE_CLIENT_ID=…            # same client as the console entry
GOOGLE_CLIENT_SECRET=…
AUTH_SECRET=<64+ random chars>   # openssl rand -base64 48
```

- Cookies: `Secure` is enabled automatically when `NODE_ENV=production`
  (`lib/auth/env.ts`), `HttpOnly` + `SameSite=Lax` always.
- `NEXT_PUBLIC_SITE_URL` feeds `metadataBase`, canonical `/`, Open Graph URL
  and social metadata (already implemented in `app/layout.tsx`).
- PWA: manifest + service worker v2 + icons are already in place; after DNS
  and TLS, verify installability on the real domain once.

## 5) Post-deploy verification checklist (when staging goes live)

1. `https://staging.fahimni.me` returns the landing page behind basic auth.
2. Google sign-in with a test user → session cookie set with `Secure`.
3. `https://fahimni.me/privacy` and `/terms` render (still draft-labelled).
4. `curl -I` shows `X-Content-Type-Options`, `X-Frame-Options`,
   `Referrer-Policy`, `Permissions-Policy` and the proxy HSTS header.
5. Lighthouse/PSI on the real domain (not runnable locally in this phase).

## 6) What is explicitly NOT done

- No DNS changes. No certificate issuance. No Google console changes.
- No claim that production sign-in works — local production-build testing used
  the localhost origin, which is a different (weaker) verification than the
  real domain round-trip.
