# Fahimni Staging Runbook — isolated deployment (execute ONLY with owner authorization)

Scope: deploy the Fahimni **staging** stack on the existing VPS next to LooksLoop
without touching anything unrelated. Nothing here has been executed yet.

## 0. Hard rules

- NEVER stop, restart, rename or reconfigure LooksLoop containers/volumes/networks.
- Fahimni stack is fully prefixed (`fahimni-staging-*`): names, network, volumes,
  data dir, database, encryption key — all separate.
- No public database ports. Only `127.0.0.1:3101` is published.
- Migrations target the staging database only.

## 1. Preflight (read-only)

```bash
ssh <owner-approved-user>@<host>
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'   # confirm LooksLoop untouched, list ports in use
ss -ltnp | grep -E ':(3100|3101)\b' || echo "ports 3100/3101 free"
df -h / /data 2>/dev/null                                        # capacity for books (expect GBs)
docker --version && docker compose version
ls -ld /data 2>/dev/null
```
BLOCKER if: SSH denied (current state), ports taken by another app, <5GB free,
or Docker absent.

## 2. Staging secrets

```bash
cd /srv/fahimni && cp deploy/env.staging.example deploy/env.staging
# fill: POSTGRES_PASSWORD (strong, unique), AUTH_SECRET (openssl rand -base64 48),
# SETTINGS_ENCRYPTION_KEY (openssl rand -base64 32 — STAGING-ONLY key),
# OPENAI_API_KEY (staging key), GOOGLE_CLIENT_ID/SECRET (staging redirect URI),
# NEXT_PUBLIC_SITE_URL=https://staging.fahimni.me, TURNSTILE_* (staging keys)
chmod 600 deploy/env.staging
```
`deploy/env.staging` is gitignored and must never be committed or printed.

## 3. Build + start (staging only)

```bash
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml build
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml up -d fahimni-staging-postgres fahimni-staging-redis
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml run --rm fahimni-staging-web pnpm db:migrate
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml up -d
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml ps   # all healthy
curl -s http://127.0.0.1:3101/api/health
```

## 4. Reverse proxy + access control (staging.fahimni.me — after DNS approval)

nginx server block (staging only):
- `auth_basic` + `auth_basic_user_file` (owner-chosen credentials)
- `X-Robots-Tag: noindex, nofollow, noarchive` + `robots.txt` deny
- proxy_pass to `127.0.0.1:3101`, forward `Host` + `X-Forwarded-Proto`
- TLS via certbot; do not enable HSTS on staging.

**Alternative without DNS**: SSH tunnel only —
`ssh -L 3101:127.0.0.1:3101 <user>@<host>` then open `http://localhost:3101`.
Staging stays unreachable from the internet.

## 5. Data rules

- No real student data is copied to staging. Use isolated test accounts
  (`@fahimni.local` fixtures) and test PDFs.
- Demo offers (`plan_demo_*`) remain blocked from checkout by design.
- Never run `scripts/cleanup-qa-data.ts --confirm` or `delete-student-data.ts`
  without explicit owner approval per record list.

## 6. Rollback (staging only — never touches LooksLoop or production data)

```bash
# stop only the fahimni-staging stack
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml down
# keep volumes for inspection; to fully remove staging state (owner approval):
# docker compose ... down -v   # deletes ONLY fahimni-staging-* volumes
```
- Rollback of a bad release = rebuild previous image tag or `git checkout <sha>`
  and `up -d --build` the staging stack only.
- Restore = `scripts/backup.sh` artifacts (DB dump + books + uploads) into the
  staging DB/dirs after dropping them; `SETTINGS_ENCRYPTION_KEY` must match the
  one used when the dump was taken.

## 7. Backup + retention cron (staging host)

```
15 3 * * * BACKUP_DIR=/var/backups/fahimni-staging PG_CONTAINER=fahimni-staging-postgres DATA_DIR=/data/fahimni-staging /srv/fahimni/scripts/backup.sh
30 4 * * * docker compose --env-file /srv/fahimni/deploy/env.staging -f /srv/fahimni/deploy/docker-compose.production.yml run --rm fahimni-staging-web node --import tsx scripts/prune-data.ts
```

## 8. Post-deploy verification checklist

- [ ] `docker compose ps` all healthy; worker polling; no crash loops.
- [ ] `/api/health` 200 over the tunnel/proxy; login page loads over HTTPS.
- [ ] Google sign-in works on the staging redirect URI (owner adds it first).
- [ ] Trial claim blocked without Turnstile keys (fail-closed) — configure then retest.
- [ ] Real question on the math subject works (staging OpenAI key), credits decrease.
- [ ] AI budget card shows source: Redis; restart web container → budget NOT reset.
- [ ] Book page requires entitlement (401 without session).
- [ ] Freemius remains unconfigured/unready; no live checkout possible.
- [ ] Backup runs; a restore drill succeeds into a throwaway DB (local script pattern).
