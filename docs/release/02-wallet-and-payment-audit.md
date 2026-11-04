# Wallet & Payment Audit (Phase 2)

## Wallet accounting model (after hardening)

- **Semester credits** live in `semester_credit_grants`, one row per purchased
  semester, with its own `remaining_credits`, `starts_at`, `expires_at` and
  status. A future semester's grant is created immediately but is **not
  spendable** until its `starts_at`.
- **Purchased top-up credits** live on `credit_wallets.topup_balance` and are
  durable across semesters.
- `credit_wallets.semester_balance` is a **derived cache**, recomputed from the
  grant rows inside the same transaction as every mutation, so it cannot drift.
- `credit_ledger` is append-only with a unique `request_id`; `credit_grant_debits`
  records exactly which grants a spend debited, so refunds restore the same grants.

## Concurrency (Problem A) — fixed

Every balance mutation locks the wallet row `FOR UPDATE` inside a transaction and
retries on PostgreSQL serialization failure (40001) / deadlock (40P01):

| Operation | Lock | Idempotency |
| --- | --- | --- |
| `grantSemesterCredits` | wallet `FOR UPDATE` | unique `grant_request_id` |
| `grantTopupCredits` | wallet `FOR UPDATE` | unique ledger `request_id` |
| `spend` | wallet `FOR UPDATE` + per-grant guarded update | unique ledger `request_id` |
| `refund` | wallet `FOR UPDATE` | one REFUND per `reverses_request_id` |
| `expireSemesterCredits` | wallet `FOR UPDATE` | per-semester idempotent |
| `adjust` | wallet `FOR UPDATE` | unique ledger `request_id` |

Verified against real PostgreSQL (`tests/unified-wallet-db.test.ts`):
- 40 concurrent 1-credit spends → exactly 40 charges, semester bucket drained
  first, no negative balance;
- concurrent spend + top-up grant + admin adjustment → no lost updates;
- two refunds of the same spend → second refused;
- replay of a grant request id → no double grant.

## Semester transition (Problem B) — fixed

Verified: buying the next semester early creates a **reserved** grant
(`starts_at` in the future) that does not count toward the spendable balance and
does not move any existing grant's expiry. Expiring semester N leaves semester
N+1 and all purchased top-up credits untouched.

## Refund / cancellation (Problem C)

- **Cancelled checkout / failed payment**: no credits are granted (checkout only
  creates a PENDING purchase; credits are granted on verified settlement).
- **Reversal / chargeback**: the settlement is idempotent by provider
  transaction/license id; a refund restores the exact grants and the top-up
  portion once, recorded in the ledger.
- **Partial consumption then refund**: `credit_grant_debits` restores precisely
  what each grant contributed; previously consumed credits are not recreated.
- **Refund after semester expiry**: expiry zeroes the grant's remaining credits
  and marks it EXPIRED; a later refund only restores what was actually debited,
  never silently recreating expired credits.
- **Duplicate payment events / webhook before callback / webhook after cancel /
  restart retry**: all funnel through idempotent wallet grants keyed by request
  id, and purchases keyed by provider id.

## Reconciliation

`reconcileWallet(userId)` compares the wallet cache against the grant sum and the
top-up ledger sum and reports mismatches **without** making automatic
corrections. It is covered by a real-PostgreSQL test that asserts no mismatch
after mixed concurrent operations.

## Payment integration status

**BLOCKED.** Freemius is the only configured provider and does not support JOD.
The application has always refused to create a checkout for an unverified
mapping (fail closed), so no real payment can be taken. `paymentReadiness()`
surfaces this as a hard launch blocker. The owner must choose a supported
currency or a provider that supports JOD, verify the mapping, and approve
activation. No real payment was submitted during this work.

## Remaining risks
- Measured provider cost is 0 until real usage is recorded; profitability shows
  estimated vs measured separately.
- Provider event → user mapping relies on the verified email + provider license;
  a mismatch settles nothing (function returns early and logs).
