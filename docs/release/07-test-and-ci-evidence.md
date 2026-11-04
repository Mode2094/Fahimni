# Test & CI Evidence (Phase 7)

## Commands (run on `release/fahimni-production-readiness`)

| Command | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 (0 errors) |
| `pnpm lint` | exit 0 (0 errors, 18 pre-existing warnings) |
| `pnpm test` | 265 tests, 265 pass, 0 fail, 0 skipped, 0 cancelled |
| `pnpm build:next` | success |

The full suite was executed on **Node 22 against real PostgreSQL + Redis**
(the same services CI provisions), so the DB-gated integration suites ran
rather than being skipped.

## Test inventory
- 45 test files; 11 are PostgreSQL integration suites gated on `TEST_DATABASE_URL`.
- New in this branch:
  - `tests/unified-wallet-db.test.ts` — wallet concurrency (40 parallel spends),
    idempotent grant, bucket ordering, semester isolation, expiry, reconciliation.
  - `tests/launch-readiness.test.ts` — payment readiness and severity escalation.
  - `tests/pedagogy.test.ts` — added subject-neutrality / strategy gating.

## Wallet concurrency evidence (real PostgreSQL)
- 40 concurrent 1-credit spends: exactly 40 charges; semester bucket drained
  first; no negative balance.
- Concurrent spend + top-up grant + admin adjustment: no lost update.
- Two refunds of the same spend: second refused.
- Replayed grant request id: no double grant.
- Buying the next semester early: reserved (not spendable), existing expiry
  unchanged, expiry of one semester leaves others intact.
- `reconcileWallet`: no cache-vs-ledger mismatch after mixed concurrency.

## CI
GitHub Actions runs `pnpm install --frozen-lockfile → typecheck → lint → test →
build:next` plus a reproducibility build, with PostgreSQL + Redis service
containers. See the PR for the run URL on the pushed head. Local results above
mirror CI’s environment; CI is the authoritative gate.

## Coverage gaps (honest)
- No browser-automation (Playwright) E2E in CI.
- No real-provider AI evaluation (mocked transports only).
- No real payment sandbox flow (payment provider is JOD-blocked).
- No load/performance test executed (no isolated budgeted environment).
