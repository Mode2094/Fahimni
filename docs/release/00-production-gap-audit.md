# FAHIMNI — Production Gap Audit (Phase 0)

Branch under audit: `release/fahimni-production-readiness`
Base: `feat/unified-semester-subscription` (PR #2) → `feat/phase-1-ux-architecture` (PR #1) → `main`.
Inspection date: current session. `main` (`c8c2ff1`) untouched.

This audit was built from reading the actual implementation, not prior reports.
Each finding names the file(s) and the fix status in this release branch.

## Severity key
- **P0** — security, financial correctness, data integrity, legal, immediate production blocker.
- **P1** — major functionality, education quality, operational stability, launch-critical UX.
- **P2** — important, non-blocking for a safe first launch.
- **P3** — optional future enhancement.

## Findings

| # | Sev | Finding | Evidence | Status in this branch |
| --- | --- | --- | --- | --- |
| 1 | **P0** | **Wallet lost-update races.** `grantSemesterCredits`, `grantTopupCredits`, `refund`, `expireSemesterCredits`, `adjust` read-then-wrote without locking the wallet row; only `spend` locked. Concurrent grant+spend, two refunds, or adjust+consume could lose updates or drift the cache. | `lib/billing/wallet-store.ts` (pre-fix) | **FIXED** — every mutation locks the row `FOR UPDATE`; retry on serialization/deadlock. Verified by two real-PostgreSQL concurrency suites. |
| 2 | **P0** | **Semester transition corruption.** A single aggregate `semester_balance` + `semesterExpiresAt`. Buying the next semester before the current one ended merged the old remaining credits and overwrote the expiry, so old credits gained the new (later) expiry and balances merged. | `lib/billing/wallet-store.ts` `grantSemesterCredits` (pre-fix) | **FIXED** — per-semester `semester_credit_grants` with their own remaining/start/expiry; future grants reserved (not spendable until the new semester starts); expiry is per semester. |
| 3 | **P0** | **Payment cannot charge the approved amount.** Freemius does not support JOD; the app prices semesters in JOD, so no offer can be verified and none may sell — yet nothing surfaced this as a hard blocker. | `lib/freemius/verification.ts` (`SUPPORTED_CHECKOUT_CURRENCIES`, no JOD); `lib/billing/semester-store.ts` default currency JOD | **BLOCKED (owner action)** — checkout already refuses unverified mappings (fail closed). Added `paymentReadiness()` + a Launch Readiness panel that reports this as a hard blocker. No real payment is activated. |
| 4 | **P1** | **AI pipeline was mathematics-specific** for every subject: image-recognition and TTS prompts said "math image"/"math teacher"; `BASE_RULES` and coach/quiz policies used algebra-only wording; the deterministic math checker ran unconditionally; retrieval expanded every subject's query with math synonyms. | `lib/ai/provider.ts`, `lib/ai/tutor.ts`, `lib/ai/pedagogy.ts`, `lib/textbook/retrieval.ts`, `lib/textbook/subject-retrieval.ts` | **FIXED** — subject-aware provider prompts, neutral policy wording, math checker gated to math subjects, math synonym expansion opt-in. |
| 5 | **P1** | **Catalogue is effectively empty.** Only `tawjihi-math` is seeded; no other subject exists for any grade/track, so most students see no available subject. | `db/seed.ts` | **DOCUMENTED (owner content action)** — readiness matrix produced; the app never advertises a subject without a READY book. Adding subjects is an owner/content task requiring distribution rights. |
| 6 | **P1** | **No operational readiness visibility.** No aggregation of whether the platform is actually ready to launch (health, keys, payment, content, wallet). | (none existed) | **FIXED** — admin “جاهزية الإطلاق” panel with evidence-backed checks and exact owner actions. |
| 7 | **P1** | **Legal pages were short drafts** and did not describe the real subscription/credit/refund behaviour; several required documents were missing. | `app/privacy/page.tsx`, `app/terms/page.tsx` | **FIXED (pending legal review)** — eight product-specific Arabic documents; still explicitly marked as pending qualified legal review. |
| 8 | **P2** | **Reconciliation tooling absent** — no way to detect wallet-cache vs ledger drift. | — | **FIXED** — `reconcileWallet()` (read-only) reports mismatches; used by a DB test. |
| 9 | **P2** | **Profitability figures are placeholders**; measured provider cost is 0 until real usage is recorded. | `lib/admin/financials.ts` | **DOCUMENTED** — the panel separates estimated vs measured and never labels revenue as profit; placeholders remain until billing data exists. |
| 10 | **P2** | **Legacy monthly/subject offers remain in the catalogue** (grandfathered) and can still confuse; legacy terms management is still present. | `db/schema.ts`, admin subscriptions “الباقات القديمة” | **RETAINED by design** (grandfathering) — hidden from new sales; no historical records deleted. |
| 11 | **P2** | **Deployment/staging was never verified** on a real host; backup/restore not drilled. | `deploy/*` | **BLOCKED (owner infra action)** — scripts and runbooks exist and are documented; execution requires the owner’s environment. |
| 12 | **P3** | `components/classroom/Classroom.tsx` remains a large single component. | — | **RETAINED** — not required for launch; extraction deferred. |

## Dependencies between PR #1 and PR #2
- PR #2 (billing/wallet) imports PR #1 modules: auth, student store, books store,
  freemius, admin http/guard, settings service, AI access/provider.
- PR #1 has no dependency on PR #2. PR #2 is strictly stacked on PR #1.
- This release branch is based on the PR #2 head and is a further stack.

## Development-only / placeholder inventory (verified, not removed)
- Visual/dev mode: `NEXT_PUBLIC_VISUAL_DEV_MODE`, `qa/` tooling (excluded from lint scope), `app/legacy` (dev-only), the legacy bundled textbook route `app/book/[name]` (404 in production).
- Fixture lessons for subjects without a READY book are labelled in the UI and never used when a real book exists.

## Verdict
Safe corrections within the branch are complete (findings 1, 2, 4, 6, 7, 8).
Findings 3, 5, 11 require owner-supplied inputs (payment currency/account,
licensed textbook content, deployment environment) and are recorded as explicit
blockers with the exact action. See `08-launch-blockers-and-owner-actions.md`.
