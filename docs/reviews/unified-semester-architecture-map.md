# FAHIMNI — Unified Semester Subscription & Credit Wallet: Architecture Map

Status: **proposed architecture, implemented on branch `feat/unified-semester-subscription`**
(stacked on PR #1). `main` is not modified. No live payment is activated.

## 0. Where the platform actually lives

`main` (`c8c2ff1`) is the original single-page prototype. The entire platform —
catalogue, billing, entitlements, credits, admin, AI access — exists **only in
PR #1** (`feat/phase-1-ux-architecture`). This work therefore branches from the
current PR #1 head and is opened as a stacked PR. It never edits PR #1.

## 1. Before → after

### Before

- Two parallel catalogues: legacy `subject_plans` (one plan per subject ×
  MONTHLY/SEMESTER) and unified `subscription_offers` (SUBJECT/BUNDLE ×
  MONTHLY/SEMESTER). Students could buy a subject, a bundle, monthly or
  semester — several confusing options.
- Credit balance lived on `entitlements.credit_balance`, reset on a fixed
  30-day period (`CREDIT_PERIOD_MS`), and was per entitlement (bundle ≥ 1 row
  shared, but semester reset monthly).
- Admin had terms + offers + subscribers tabs, no financial reporting, no
  profitability tool, no controlled credit-cost configuration.
- No wallet ledger, no top-up product, no purchase snapshots.

### After

- **One** publicly offered paid product: **«اشتراك فهمني الفصلي»** — a semester
  subscription for a grade/track covering **every READY, authorised subject**,
  with one **unified credit wallet**.
- Admin-controlled **semester calendar** (`semesters`) with precise Asia/Amman
  boundaries, sales window, price, included credits, status, late-enrollment
  policy, top-up availability and notes.
- **Two-bucket wallet** (`credit_wallets`) + append-only **ledger**
  (`credit_ledger`): semester-included credits (expire with the semester) and
  durable purchased top-up credits.
- **Immutable purchase snapshots** (`subscription_purchases`) so editing a
  semester never rewrites a sold purchase's financial terms.
- **Top-up catalogue and purchases** (`topup_offers`, `topup_purchases`) with
  exactly-once credit grant guarded by unique provider transaction ids.
- Admin financial dashboard, proton-profitability planner, per-service credit
  cost configuration, manual adjustments with mandatory reasons and audit.

## 2. Reuse / refactor / new

| Concern | Decision | Detail |
| --- | --- | --- |
| `academic_terms` | **Keep** | Legacy terms stay for grandfathered offers. New semesters are a separate table so nothing breaks. |
| `subscription_offers`, `subject_plans` | **Keep, hide from new sales** | Grandfathered; new checkout targets semesters only. |
| `entitlements`, `entitlement_subjects` | **Reuse** | The unified semester grant is one entitlement (`subjectId = null`) with the frozen subject scope in `entitlement_subjects`. |
| `lib/billing/terms.ts` | **Reuse as-is** | Amman timezone, inclusive end-of-day, `semesterAccessWindow`, `daysRemaining`. |
| `lib/freemius/*` (client, webhook, links, readiness, verification, reconcile) | **Reuse** | Webhook verification, offer/plan link verification and idempotency are reused for semester + top-up products. |
| `lib/billing/access-map.ts` | **Extend** | Already resolves per-subject access from entitlements; the unified grant flows through it unchanged. |
| `lib/ai/access.ts` `chargeAiCredits`/`refundAiCredits` | **Refactor** | Route paid entitlement charging through the unified wallet (semester→topup) while keeping trial behaviour and provider budgets. |
| AI provider budgets, rate limits, device limits | **Preserve** | Untouched; the new wallet never bypasses them. |
| `credit_wallets`, `credit_ledger`, `semesters`, `subscription_purchases`, `topup_offers`, `topup_purchases` | **New** | Additive migration `0012`. |

## 3. Business rules (exact)

1. **One offer.** A student sees exactly one semester offer for their grade/
   track. There is no public monthly plan and no per-subject paid plan.
2. **Scope.** The subscription covers every subject with `subjectAppliesToScope`
   true **and** a READY textbook. Subjects without a ready book are never
   promised; adding a ready book later extends coverage because membership is
   evaluated live against the frozen entitlement scope + current readiness.
3. **Window.** Access = `[max(purchasedAt, semester.startsAt), semester.endsAt)`.
   Early purchases are **Scheduled** and activate at the semester start; no
   premature access. All students in a semester share the same expiry.
4. **Dates.** Admin enters `YYYY-MM-DD` in Asia/Amman. Stored boundaries are UTC
   instants; the end date is inclusive to the end of that local day. Invalid or
   overlapping active/scheduled semester ranges are rejected.
5. **Late enrollment.** Price = full price or simple whole-day proration by the
   admin's `lateEnrollmentPolicy`. Never below one minor unit.
6. **Duplicates.** One live (PENDING/ACTIVE) purchase per user+semester. Credits
   granted exactly once, keyed by purchase id.
7. **Wallet.** Spend semester-included first, then top-up. Atomic, idempotent
   per request id, guarded against negative balances and concurrent races.
8. **Expiry.** Semester credits expire at the semester end; purchased top-up
   credits persist, and are spendable only while the student holds an active
   semester entitlement.
9. **No access without entitlement.** No paid content, including spending
   top-up credits, without a valid active semester entitlement.
10. **Payments.** Prices resolved server-side; provider mappings must be
    verified before an offer sells; webhook signatures verified; every event
    idempotent; duplicate/replayed events never double-grant.
11. **Grandfathering.** Historic entitlements and any purchased credit stay
    valid until expiry. Deprecated offers are hidden from new purchases, never
    deleted.
12. **Money.** Integer minor units everywhere. No floating point in totals.

## 4. New business rules (data model)

- `semesters` — the single calendar authority. Statuses DRAFT → SCHEDULED →
  ACTIVE → ENDED → ARCHIVED. Archival never deletes.
- `subscription_purchases` — one row per purchase with a frozen price/credit/
  window snapshot and `credits_granted_at` exactly-once guard.
- `credit_wallets` — `semester_balance` + `topup_balance`, plus the semester
  grant/expiry instants.
- `credit_ledger` — append-only; unique `request_id`; signed `delta`; carries
  bucket, kind, subject, semester, entitlement, actor and note for audit.
- `topup_offers` / `topup_purchases` — one-time paid credit, unique provider
  transaction id.

## 5. Student & admin journeys

**Student.** Dashboard widget → status, semester end, days left, remaining
credits, «شحن رصيد». Subscription page → ONE offer card (name, price, dates,
included subjects, credits, how credits work) → checkout. Top-up store → pick
an offer → confirm → receipt. Credit-low and exhausted states show one clear
next action.

**Admin.** «إدارة الفصول والاشتراكات» tabs: semesters, subscriptions, credits &
top-ups, payments, financial reports, consumption settings. Create/schedule/
publish semesters, view subscribers and remaining time, inspect granted/consumed
credits, adjust balances with a reason, export CSV, view profitability planner.

## 6. Legacy migration strategy

- No destructive change. New tables only; legacy rows untouched.
- Legacy offers/plans are excluded from new checkout (only semesters sell).
- Historic entitlements remain valid until expiry (the access layer still reads
  them). Purchased credits are untouched.
- Duplicate prevention: the unified grant is keyed by purchase id and the
  provider license id; re-running provisioning never double-grants.
- Transition: when the owner publishes a semester, new students buy the unified
  offer; existing customers keep their recorded scope until expiry, then renew
  into the unified offer. A migration tool can move them earlier — not enabled
  without owner approval.

## 7. Payment-provider compatibility (findings so far)

- Freemius supports one-off purchases; JOD is **not** in the currently supported
  checkout currencies (`lib/freemius/verification.ts`), so a semester price in
  JOD cannot be verified for checkout yet. The unified offer therefore stays
  unavailable for live checkout until the provider mapping is verified and the
  owner approves. No real payment link is activated in this change.

## 8. Non-negotiable boundaries respected

- One paid semester model; all ready subjects; exact dates; one wallet; durable
  purchased credits; top-ups without another subscription; server-side price
  and credit accounting; zero double charge/grant; no fabricated payments or
  profit; no historical deletion; no live activation; PR #1 and `main` untouched.
