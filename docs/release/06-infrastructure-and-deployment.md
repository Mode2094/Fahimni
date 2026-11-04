# Infrastructure & Deployment (Phase 12)

## Topology (from `deploy/docker-compose.production.yml`, `Dockerfile`)
- One image (Node 22 + pnpm + Python 3 + PyMuPDF) used by the **web** service
  (`next start`, port 3100) and the **worker** service
  (`node --import tsx scripts/index-worker.ts`).
- **postgres:16-alpine** (named volume, `pg_isready` healthcheck) and
  **redis:7-alpine** (AOF, `noeviction`, `redis-cli ping` healthcheck).
- Private network `fahimni-net`; web published only on `127.0.0.1:${WEB_PORT}`
  for a reverse proxy. Bounded log rotation. Staging reuses the file with
  `env.staging` and prefix `fahimni-staging` on port 3101.
- Named volumes: `${STACK_PREFIX}-pg-data`, `${STACK_PREFIX}-redis-data`;
  bind mount `${DATA_HOST_DIR}` for books/uploads.

## Migrations & seeding
- Migrations are deliberate, never run on startup:
  `docker compose ... run --rm fahimni-web pnpm db:migrate`.
- Seed (first launch only): `pnpm db:seed`.
- Worker supports `--once`; `WORKER_POLL_MS` default 5000.

## Backups
- `scripts/backup.sh` dumps Postgres (`pg_dump` in container) and tars
  `DATA_DIR/books` + `DATA_DIR/uploads`. `SETTINGS_ENCRYPTION_KEY` is **excluded**
  from backups by design (store it separately).

## Required production env (from `deploy/env.production.example`)
`DATABASE_URL`, `REDIS_URL`, `DATA_DIR`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`,
`ADMIN_EMAILS`, `SETTINGS_ENCRYPTION_KEY`, OpenAI keys/models, Freemius
credentials, Turnstile keys, `TRIAL_DAILY_AI_BUDGET_USD`, `NEXT_PUBLIC_SITE_URL`.

## Safety on a shared server
The runbook requires read-only preflight only when authorised; unrelated
apps/containers/volumes/ports/networks must never be stopped, removed or
reconfigured; staging is isolated by prefix and port.

## Verified in this session
- The image builds and the production build succeeds locally.
- Migrations apply cleanly to a fresh PostgreSQL (see Phase 7 test evidence).

## NOT verified (owner/infra)
- No real deployment, staging deploy or production migration was performed.
- No backup/restore drill was executed against a real host.
- Reverse proxy / TLS / DNS are owner-provided.

## Honest status
Deployment configuration is prepared and documented. Execution and the
staging verification checklist require the owner’s environment and credentials;
this is recorded as blocker B3.
