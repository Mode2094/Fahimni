# Fahimni — Production Deployment (isolated stack)

Everything below is scoped to the `fahimni` project only. It never touches
other containers, networks, volumes or databases on the VPS.

## 1. Prepare

```bash
cp deploy/env.production.example deploy/env.production
# fill in secrets (AUTH_SECRET, Google, OpenAI, Freemius, POSTGRES_PASSWORD)
mkdir -p /data/fahimni
```

`DATABASE_URL` / `REDIS_URL` in the env file already point at the internal
`fahimni-postgres` / `fahimni-redis` services.

## 2. Build and start

```bash
docker compose -f deploy/docker-compose.production.yml build
docker compose -f deploy/docker-compose.production.yml up -d fahimni-postgres fahimni-redis

# migrations are deliberate, never automatic on web startup
docker compose -f deploy/docker-compose.production.yml run --rm fahimni-web pnpm db:migrate
docker compose -f deploy/docker-compose.production.yml run --rm fahimni-web pnpm db:seed   # first launch only

docker compose -f deploy/docker-compose.production.yml up -d
```

Web listens on **127.0.0.1:3100** only. Point the host reverse proxy for the
Fahimni domain at it. PostgreSQL and Redis publish no host ports.

## 3. Verify

```bash
curl -s http://127.0.0.1:3100/api/health
docker compose -f deploy/docker-compose.production.yml ps
docker compose -f deploy/docker-compose.production.yml logs -f fahimni-worker
```

## 4. Updates

```bash
git pull
docker compose -f deploy/docker-compose.production.yml build
docker compose -f deploy/docker-compose.production.yml run --rm fahimni-web pnpm db:migrate
docker compose -f deploy/docker-compose.production.yml up -d
```

## 5. Backups

```bash
BACKUP_DIR=/var/backups/fahimni bash scripts/backup.sh
```

Produces `fahimni-db-<timestamp>.sql.gz` (via the `fahimni-postgres` container),
`fahimni-books-<timestamp>.tar.gz` from `DATA_DIR/books`, and
`fahimni-uploads-<timestamp>.tar.gz` from `DATA_DIR/uploads` (admin-uploaded
subject images). Only Fahimni containers and paths are touched.

Restore (example):

```bash
gunzip -c /var/backups/fahimni/fahimni-db-<stamp>.sql.gz | \
  docker exec -i fahimni-postgres psql -U fahimni -d fahimni
tar -xzf /var/backups/fahimni/fahimni-books-<stamp>.tar.gz -C /data/fahimni
tar -xzf /var/backups/fahimni/fahimni-uploads-<stamp>.tar.gz -C /data/fahimni
```

### Encryption key and encrypted settings

`SETTINGS_ENCRYPTION_KEY` (see `env.production.example`) is required before the
owner can save the OpenAI key or Freemius credentials from the admin dashboard.
Rules:

- Never store the key in PostgreSQL and never include it in database backups.
- Keep it in a secret manager / protected host file; it must survive server
  rebuilds exactly like the database.
- Restoring a database backup without the original key leaves encrypted
  settings unreadable. The app then fails closed (treats them as unconfigured)
  and falls back to the environment variables in `env.production`, so keep
  those env values available as a recovery path.
- Rollback strategy: migrations are forward-only; to roll back an application
  update, restore the database backup taken before `pnpm db:migrate` and redeploy
  the previous image. `DATA_DIR` (books + uploads) is version-independent.

## 6. Notes

- The worker image contains Python 3 + PyMuPDF; no host Python needed.
- `/data/fahimni` is a host bind mount shared by web and worker.
- Migrations (`pnpm db:migrate`) run deliberately before deploying updates.

## 7. Freemius dashboard requirements (subscriptions)

Fahimni supports four offer combinations: single subject or all-subject bundle,
each monthly (recurring) or semester (one-off). Configure Freemius once:

1. **Allow multiple subscriptions per user.** By default Freemius SaaS products
   restrict users to one active subscription and checkout blocks additional
   purchases. Go to **Product → Settings** and disable **Restrict Single
   Subscription Per User**; otherwise a student who already pays for one subject
   cannot buy a second subject or a bundle. (Existing products created before
   this toggle existed have it disabled already; new products have it enabled by
   default — verify it explicitly.)
2. **Monthly offers** must map to a plan with **monthly recurring pricing**.
   Fahimni refuses to grant a monthly offer from a one-off purchase
   (`plan_mismatch`), and access follows the license `expiration` (paid-through
   date); a canceled renewal keeps access until that date.
3. **Semester offers** must map to a plan with **one-time (one-off) pricing**.
   Freemius one-off licenses report `expiration: null` (lifetime) — Fahimni
   ignores that and clamps local access to the academic term end (Asia/Amman).
   A recurring subscription is refused for a semester offer.
4. Enter the Freemius **plan id** for each offer in `/admin/subscriptions`
   (or the legacy per-subject plans panel). The id must be unique across all
   offers; the webhook resolves it unambiguously and refuses unknown mappings.
5. Bundle scope is frozen at purchase time: editing the covered subjects later
   never widens already-sold access; a deliberate Freemius plan change
   (same license) re-scopes to the new offer.
6. Webhooks stay authoritative: entitlements are only written from verified
   `license.*` events by re-fetching the purchase from the Freemius API, never
   from checkout redirects.

## 8. Free trial (Turnstile + budget)

One free trial per Google account and per browser identity (hashed HttpOnly
cookie), 15 credits valid 48h from the first accepted AI request. One shared
wallet across all eligible subjects; no Freemius license is ever created.

1. Create a Cloudflare Turnstile widget (free tier) for the app domain and set
   `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` (optionally
   `TURNSTILE_EXPECTED_HOSTNAME`). **Production trial activation fails closed
   when the secret is missing**; paid subscriptions and AI for paid students
   keep working regardless.
2. Set `TRIAL_IDENTITY_SECRET` (any random 32-byte string) so the trial browser
   identity HMAC is independent from `AUTH_SECRET`.
3. Set `TRIAL_DAILY_AI_BUDGET_USD` as the global daily ceiling for trial AI
   spend (Redis-backed atomic reservations; paid students are never blocked).
   Admins can override settings for new claims in Admin → Settings →
   التجربة المجانية.
4. Anti-reuse limitations are intentional and documented in the UI: clearing
   cookies or switching browsers can bypass the browser layer; accounts remain
   permanently protected. A support path is shown to shared-device students.
