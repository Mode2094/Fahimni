# Security & Privacy Review (Phase 9)

Defensive review of the current implementation. No exploit was executed; this is
a code-level assessment with the mitigations actually present.

## Authentication & sessions
- Google OAuth server-to-server code exchange; state HMAC-signed, expiring,
  tamper-evident; `returnTo` restricted to same-origin relative paths.
- Sessions stored as HMAC-SHA256 digests of the cookie token; the raw token is
  never stored. Cookie is HttpOnly, `SameSite=Lax`, `Path=/`, `Secure` in
  production. Expired sessions are rejected and pruned.
- `AUTH_SECRET` required in production (fail closed).

## Authorization
- Admin pages: `requireAdmin` (server-side role check). Admin APIs:
  `authorizeAdminRequest` (same-origin + ADMIN session; a STUDENT session is
  treated as anonymous).
- All entitlement and credit decisions are server-side; the browser never sends
  a role, user id, price, plan id or credit value.
- IDOR: routes resolve the user from the session; cross-user data is not
  addressable by client-supplied ids (e.g. wallet/ledger are always the caller’s).

## CSRF / same-origin
- Every mutating route checks `sameOrigin(request)`; `X-Forwarded-Host` is never
  trusted. Verified by tests.

## Payment integrity
- Server-side price lookup; verified provider mappings only; demo plan ids
  rejected; webhook signature verification; unique external ids; idempotent
  fulfillment; no credits from redirects; duplicate webhook/replay safe.
- The wallet grants are idempotent by request id; purchases keyed by provider id.

## Input validation & uploads
- Zod schemas on every route; money parsed to integer minor units without floats.
- Book upload: size + MIME + PDF-signature validation; UUID-derived storage
  paths; path-traversal rejected; page image routes verify containment.
- Image upload route validates and normalizes.

## Prompt injection & untrusted model output
- Retrieved text and user content are labelled as data, never instructions.
- Image prompt explicitly instructs to treat in-image instructions as untrusted.
- Model output is schema-validated (Zod + structured outputs) before use; LaTeX
  is rendered with KaTeX `trust:false`, `throwOnError:true`.

## Secrets & logging
- Secrets encrypted at rest (authenticated cipher); encryption root key lives
  outside the DB. Provider errors logged without keys/payloads.
- Privacy: no question text in billing logs; usage events store credits/cost
  only; free-trial identity uses HMAC of a cookie, never a fingerprint.

## Privacy for minors
- Data minimization; learning progress is private to the account; deletion tooling
  exists (`scripts/delete-student-data.ts`, dry-run by default).
- Privacy policy documents data handling and states that legal review is pending.

## Infrastructure
- Containers run as the app user; the web port is published only on
  `127.0.0.1` behind a reverse proxy; Postgres/Redis are on a private network.
- Dependency, container-permission and public-asset exposure reviewed in the
  deployment doc; no secrets committed.

## Open items (owner/infra, not code defects)
- No automated dependency-vulnerability scan in CI (recommend adding one).
- No external penetration test performed.
- Legal compliance (Jordan PDPL / minors) requires qualified legal review.
