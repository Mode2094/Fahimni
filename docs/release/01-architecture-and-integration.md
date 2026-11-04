# Architecture & Integration (Phase 1)

## Branch topology

```
main (c8c2ff1, prototype, untouched)
  └─ feat/phase-1-ux-architecture            (PR #1)
       └─ feat/unified-semester-subscription (PR #2)
            └─ release/fahimni-production-readiness  (this branch, PR #3)
```

No history was rewritten; no existing branch force-pushed; `main` unchanged.

## Billing architecture (after this release)

- **One public product:** the unified semester subscription. Legacy
  `subject_plans` / `subscription_offers` remain only for grandfathered records
  and are hidden from new sales.
- **Semester calendar:** `semesters` (Asia/Amman dates, inclusive end-of-day,
  overlap rejection, frozen financial terms once sold).
- **Entitlement:** one all-subject entitlement per purchase (`subjectId = null`)
  with the frozen subject scope in `entitlement_subjects`.
- **Wallet:** `credit_wallets` (cache) + `semester_credit_grants` (per-semester)
  + `credit_ledger` + `credit_grant_debits`.
- **Purchases:** `subscription_purchases` (immutable snapshot), `topup_offers`,
  `topup_purchases`.
- **AI access:** `lib/ai/access.ts` charges the unified wallet for semester
  entitlements, keeps the legacy per-entitlement path for grandfathered rows,
  and preserves trial + provider budget + rate-limit gates.

## Integration fixes in this branch
- Subject-aware AI across provider/tutor/pedagogy/retrieval (Phase 6).
- Wallet concurrency + semester-isolation (Phase 2/3).
- Launch Readiness panel (Phase 8).
- Complete legal documents (Phase 10).

## Migrations (additive only)

| File | Adds |
| --- | --- |
| `0012_giant_misty_knight.sql` | semesters, subscription_purchases, credit_wallets, credit_ledger, topup_offers, topup_purchases |
| `0013_foamy_captain_stacy.sql` | semester_credit_grants, credit_grant_debits |

No existing table is altered destructively; no data is deleted. Rollback for
0013/0012 is a drop of the new tables (documented limitation: no automatic
down-migration of data).

## Merge sequence (proposed, pending owner approval)
1. Review & merge PR #1 (platform) → `main`.
2. Review & merge PR #2 (unified subscription) → `main`.
3. Review & merge PR #3 (this release hardening) → `main`.
Each step is a fast-forward of the previous; no rebase required.
