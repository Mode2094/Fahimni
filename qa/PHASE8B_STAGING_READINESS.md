# Phase 8B — Staging readiness checklist (Gate A artifact)

Legend: READY = verified locally · BLOCKED = requires owner/remote · N/A = not used.
No secret values are recorded here.

| # | Item | Status | Notes / exact requirement |
| --- | --- | --- | --- |
| 1 | SSH access & host identity | **BLOCKED** | All local keys were rejected (publickey denied). Owner must approve an access method and provide the user/host. |
| 2 | Domain ownership & DNS | **BLOCKED** | `fahimni.me` records are NOT touched. Needed later: A @ → VPS, CNAME staging → apex (only with explicit approval). |
| 3 | TLS strategy | READY (plan) | certbot per hostname at the proxy; HSTS production-only; staging without HSTS. Execution blocked by #1/#2. |
| 4 | Google OAuth client & redirects | **BLOCKED** | Staging redirect `https://staging.fahimni.me/api/auth/google/callback` must be added by the owner in Google Console. Tunnel mode can temporarily use the localhost origin for admin-only checks. |
| 5 | OpenAI API key | READY (local) / pending staging value | Local key configured and used in real tests; staging needs its own key in `deploy/env.staging`. |
| 6 | PostgreSQL credentials | READY (generation step) | Staging password to be generated at deploy time (`openssl rand`); never reused from production. |
| 7 | Redis | READY (design) | Internal-only (no password by design on the private network, no published port, `noeviction` + maxmemory). App requires `REDIS_URL` in production (fail-closed). |
| 8 | Encryption secrets | READY (generation step) | Staging gets its OWN `SETTINGS_ENCRYPTION_KEY`; must be stored in a secret manager and excluded from DB backups. |
| 9 | Freemius credentials & webhook | **BLOCKED** | No product/developer credentials provided. Webhook endpoint will be `https://<staging>/api/webhooks/freemius` once TLS exists. Checkout stays blocked meanwhile. |
| 10 | Backup storage | READY (script) / pending path on host | `scripts/backup.sh` covers DB + books + uploads; cron lines in `deploy/STAGING_RUNBOOK.md`. Host path `/var/backups/fahimni-staging` to be created at deploy. |
| 11 | Email/support settings | N/A + WhatsApp READY | No email infrastructure is used; support is WhatsApp (DB setting `962793519944` verified live on the landing). |
| 12 | Server capacity | **BLOCKED** | Cannot inspect CPU/RAM/disk without SSH. Local production build: RSS ≈860MB under load; compose defaults: web 1536m / worker 1024m / pg 768m / redis 256m. |
| 13 | Port availability | Locally READY; remotely **BLOCKED** | `127.0.0.1:3101` is free locally (verified). Remote check is step 1 of the runbook. |
| 14 | Compose isolation | READY | `docker compose config` with the staging env file: all names/volumes/networks prefixed `fahimni-staging`, only `127.0.0.1:3101` published, healthchecks, restart policies, mem/cpu limits, log rotation. |
| 15 | Migration safety | READY | Migrations run via one-off `run --rm fahimni-staging-web pnpm db:migrate` against the staging DB only; 11 migrations verified on a restored database. |
| 16 | Access protection for staging | READY (design) | Basic auth + noindex header + robots deny at the proxy, or SSH tunnel with no public exposure. Never robots.txt alone. |
| 17 | Data isolation | READY | No student data copied; fixtures only. Cleanup scripts run in DRY-RUN only (see report). |

## Local quality gates (executed in this phase)

- `pnpm typecheck` — pass
- `pnpm test` (TEST_DATABASE_URL + REDIS_URL) — 211/211
- `pnpm build:next` — pass
- `docker compose config` (staging env) — pass
