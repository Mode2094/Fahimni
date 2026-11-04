# FAHIMNI — Unified Semester Subscription & Credit Wallet: Engineering Report

Branch: `feat/unified-semester-subscription` (stacked on PR #1
`feat/phase-1-ux-architecture`). `main` and PR #1 are unmodified. No live payment
was activated.

## 1. Before-and-after subscription architecture

**Before.** Two parallel catalogues — legacy `subject_plans` (one plan per subject
× monthly/semester) and `subscription_offers` (subject/bundle × monthly/semester)
— let students buy a subject, a bundle, monthly or semester. Credits lived on
`entitlements.credit_balance` and reset on a fixed 30-day window. There was no
wallet ledger, no top-up product, no purchase snapshot, and no financial or
profitability reporting for admins.

**After.** ONE publicly offered paid product — **«اشتراك فهمني الفصلي»** — an
admin-controlled semester subscription for the student's grade/track covering
**every READY, authorised subject**, with ONE unified two-bucket credit wallet
(semester-included + durable purchased top-up credits).

## 2. Exact new business rules

1. One public offer per grade/track. No public monthly plan, no per-subject paid plan.
2. Coverage = every subject with `subjectAppliesToScope` true **and** a READY textbook.
   A grade-wide subject is covered by a track semester; a subject without a ready
   book is never promised. Adding a ready book extends live coverage.
3. Access window `[max(purchasedAt, semester.startsAt), semester.endsAt)`. Early
   purchases are **Scheduled** and activate at the semester start; all students in
   a semester share one expiry.
4. Dates are entered in **Asia/Amman**; boundaries are stored as exact UTC
   instants with an inclusive end-of-day. Invalid and overlapping active/scheduled
   semesters for the same scope are rejected.
5. Late enrollment: `FULL_PRICE` or simple whole-day `PRORATED`, never below 1 minor unit.
6. One live (PENDING/ACTIVE) purchase per user+semester; credits granted exactly once.
7. Wallet spends semester credits first, then top-up; atomic, idempotent per
   request id, never negative.
8. Semester credits expire at semester end; purchased top-up credits persist and
   are spendable only with an active semester entitlement.
9. No paid content (or top-up spending) without a valid active entitlement.
10. Prices resolved server-side; provider mappings verified before selling;
    webhook signatures verified; every event idempotent; no double charge/grant.
11. Historic entitlements and purchased credits stay valid; deprecated offers are
    hidden from new purchases, never deleted.
12. Integer minor units everywhere; no floating-point money.

## 3. Student & admin user journeys

**Student.** Dashboard widget (status, semester end, days left, unified balance,
«شحن رصيد») → subscription page with ONE offer card (name, price, dates, included
subjects, credits, how credits work, one primary action) → checkout. Separate
top-up store: current balance, offers, recent transactions, confirmation.
Scheduled / active / expired / exhausted states each show one clear next action.

**Admin.** «إدارة الفصول والاشتراكات» with tabs: الفصول الدراسية, الاشتراكات,
الكريدت والشحن, المدفوعات, التقارير المالية, إعدادات الاستهلاك (plus the
grandfathered الباقات القديمة and freemius status). Create/schedule/publish
semesters, view subscribers and remaining time, grant/consume totals, authorised
manual adjustments with a mandatory reason, CSV export, and a profitability planner.

## 4. Screens developed or redesigned

- `app/(student)/app/subscription/page.tsx` — rewritten around the single offer.
- `app/(student)/app/topup/page.tsx` — new top-up store.
- `components/student/subscription-widget.tsx` — new dashboard widget.
- `components/student/semester-checkout.tsx` — client checkout launchers.
- `components/student/student-nav.tsx` — added «رصيدي».
- `app/(student)/app/page.tsx` — dashboard now shows the subscription widget.
- `app/admin/subscriptions/page.tsx` — new tab set and section dispatch.
- `components/admin/semesters-section.tsx`, `topups-section.tsx`,
  `financial-sections.tsx` — new admin sections.

## 5. Database changes and migrations

Additive migration `drizzle/0012_giant_misty_knight.sql` (new enums + tables,
no changes to existing tables):

- `semesters` — the single admin calendar authority.
- `subscription_purchases` — immutable per-purchase snapshot + exactly-once grant.
- `credit_wallets` — two buckets per user (`semester_balance`, `topup_balance`).
- `credit_ledger` — append-only, unique `request_id`, bucket/kind/delta/actor/note.
- `topup_offers` — admin catalog (draft → active → paused → archived).
- `topup_purchases` — one-time top-up with unique provider transaction id.

All money is integer minor units; FK/unique/index constraints are explicit.
Existing users, transactions, entitlements and purchased credits are untouched.
Rollback: the migration is additive; dropping the new tables reverts it without
touching legacy data. Documented limitation: no automatic data down-migration.

## 6. Payment-provider compatibility (findings)

- Freemius supports verified one-off purchases and the existing webhook/links/
  readiness machinery is reused for both semester and top-up products.
- **JOD is not in the Freemius supported checkout currencies**
  (`lib/freemius/verification.ts`), so a JOD-priced semester cannot be verified for
  live checkout yet. The offer therefore stays unavailable until the provider
  mapping is verified and the owner approves. No real payment link is activated.
- No card data is stored. Server-side price lookup, verified mappings, signature
  verification, unique external ids and idempotent handling are enforced.

## 7. Credit wallet accounting and refund behaviour

- Spend: semester bucket first, then top-up; a `SELECT … FOR UPDATE` row lock
  serialises concurrent spends so parallel requests cannot overspend; the ledgers
  write one row per debited bucket sharing the request id.
- Duplicate request id → duplicate, no charge.
- Refund: restores exactly the buckets the original spend debited, once; a second
  refund of the same spend is refused (`already_refunded`).
- Grant: semester and top-up grants are idempotent by request id
  (`semester-grant:<purchaseId>`, `topup-grant:<transactionId>`).
- Expiry: semester credits are zeroed (ledger `EXPIRE`); purchased credits survive.
- Only refunds a charge that actually happened; aborted/failed provider calls are
  refunded once; provider budgets and rate limits are unchanged.

## 8. Security review

- All credit and price values are server-controlled; the browser sends only uuids.
- Checkout validates same-origin, session, onboarding, grade/track scope,
  sellability, verified provider mapping and duplicate purchase.
- Webhook events are signature-verified by the SDK listener, idempotent by event
  id, and settle through idempotent wallet grants.
- Admin routes use `authorizeAdminRequest` (same-origin + ADMIN session);
  adjustments require a mandatory reason recorded with the acting admin id.
- No secrets, provider costs or payment payloads are exposed to students. No card
  details are stored.

## 9. Legacy subscription migration strategy

- No destructive change; legacy catalogue and entitlements remain valid until expiry.
- Legacy offers/plans are hidden from new sales (only semesters sell); they remain
  manageable under «الباقات القديمة».
- Duplicate prevention: the unified grant is keyed by purchase id + provider
  license id, so re-running never double-grants.
- Transition path: publish a semester; new students buy the unified offer; existing
  customers keep their recorded scope until expiry and then renew into the unified
  offer. An earlier migration tool is not enabled without owner approval.

## 10. Profitability calculation methodology

`projectProfitability` takes admin assumptions (semester price, credits, expected
subscribers, average AI cost/student, payment fees, acquisition cost, fixed
expenses, top-up assumptions) and returns gross revenue, variable AI cost,
payment fees, acquisition cost, contribution margin, contribution per subscriber,
break-even subscriber count and projected surplus. Revenue, gross profit and
margin are separate; **revenue is never labelled profit**. The tool marks all
figures as editable drafts and states they are projections, not guaranteed
revenue. Assumptions are shown prominently.

## 11. Tests executed and results

New suites:
- `tests/unified-subscription.test.ts` (13) — Amman windows, scope resolution,
  late enrollment, sellability, provisioning/idempotent grant, wallet buckets,
  refunds, expiry, status, overlap detection.
- `tests/unified-payments.test.ts` (3) — semester checkout authorization +
  verified mapping + duplicate guard; webhook replay grants semester credits once;
  top-up replay grants purchased credits once.
- `tests/unified-subscription-ui.test.ts` (4) — Arabic RTL widget states
  (active/scheduled/none/expired/exhausted), no invented data.
- `tests/unified-wallet-db.test.ts` (1) — real PostgreSQL: migration applies,
  40 concurrent spends are atomic and never negative, idempotent grant, bucket
  ordering, expiry preserves purchased credits.

Existing regression suites all pass. Full run on Node 22 with real PostgreSQL +
Redis: **259 tests, 259 pass, 0 fail, 0 skipped, 0 cancelled**.

## 12. CI result and URL

GitHub Actions on the branch head `470ece7`:
https://github.com/Mode2094/Fahimni/actions/runs/41847053376 — **success**
(both jobs: `install · test · typecheck · lint · build` and
`production build (reproducibility)`).

Local verification: `pnpm typecheck` (0 errors), `pnpm lint` (0 errors, 18
pre-existing warnings), `pnpm test` (259/259 on Node 22 with real PostgreSQL +
Redis), `pnpm build:next` (pass).

## 13. Browser screenshots or testing limitations

No browser automation dependency is shipped, so RTL rendering is verified through
jsdom component tests plus the existing manual browser evidence. The subscription
widget is covered by `unified-subscription-ui.test.ts` (Arabic strings, RTL,
status/credit states). Real-payment UI cannot be exercised until a provider
mapping is verified, by design.

## 14. Known risks and pending configuration decisions

- **Freemius JOD support** must be resolved (or a supported currency used) before
  any semester or top-up offer can sell. This is the blocking configuration decision.
- Profitability figures are admin-entered assumptions, not measured costs, until
  real provider costs are recorded (`measuredProviderCostMicroUsd` is 0 today).
- Legacy monthly/subject plans remain in the catalogue for grandfathered customers;
  an active migration of existing customers has not been performed (owner decision).
- No deployment or production migration was run.

## 15. Branch, commit and PR

- Branch: `feat/unified-semester-subscription`
- Base: `feat/phase-1-ux-architecture` (PR #1) — stacked PR.
- Head commit: `470ece7298b97791a2adce01db0bb0bd4ecea173`
- PR: https://github.com/Mode2094/Fahimni/pull/2

## 16. Confirmation

- `main` was **not** modified (still `c8c2ff1f4758d6457ae6630163f6701d038992b2`).
- PR #1 was **not** edited or merged.
- No deployment, no production migration, no live payment activation.
- No historical records were deleted; the schema change is additive.
