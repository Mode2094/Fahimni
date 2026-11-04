# Launch Blockers & Owner Actions (Phase 8)

The engineering work that can be done without owner-supplied external inputs is
complete. The following are **explicit, actionable blockers**. Each states what is
needed and who must provide it. None can be resolved by code alone.

## B1 — Payment provider currency (P0, owner + provider)
**Problem:** Freemius does not support JOD; semesters are priced in JOD, so no
offer can be verified and none may sell (checkout fails closed).
**Owner action (choose one):**
1. Re-price the semester in a Freemius-supported currency (USD/EUR/GBP/CAD/AUD/
   ILS/PLN/CHF/RSD) and disclose any conversion to students, **or**
2. Integrate a provider that supports JOD (behind the same payment abstraction),
   **or**
3. Confirm Freemius now supports JOD and update `SUPPORTED_CHECKOUT_CURRENCIES`.
Then verify the plan mapping and **explicitly approve** checkout activation.

## B2 — Educational content & rights (P1, owner)
**Problem:** only `tawjihi-math` exists; no other subject for any grade/track is
defined, and only subjects with a READY, licensed book are offered.
**Owner action:** for each subject to launch, provide distribution rights and
upload the textbook (see `03-educational-quality-audit.md`, content-import
checklist). Do not upload content without rights. The platform never advertises
an unready subject.

## B3 — Deployment & staging verification (P1, owner/infra)
**Problem:** no real deployment, staging deploy, production migration, or
backup/restore drill has been executed; the owner’s host and credentials are
required.
**Owner action:** provision an isolated staging environment (per
`deploy/docker-compose.production.yml` + `deploy/env.staging.example`), run
`pnpm db:migrate`, seed, and complete the STAGING_RUNBOOK verification checklist
(health, sign-in, trial fail-closed, lesson + credit deduction, AI budget source
= redis, entitlement 401, Freemius unready, backup/restore drill).

## B4 — Legal approval (P1, owner + legal counsel)
**Problem:** the eight legal documents are complete drafts but not approved.
**Owner action:** obtain qualified legal review (Jordan PDPL, minors, consumer
cancellation/refund rights), fill in the business identity/address/support
contact, then mark reviewed.

## B5 — Business & operational configuration (P1, owner)
**Owner action:**
- Set `ADMIN_EMAILS`, `SETTINGS_ENCRYPTION_KEY`, real AI key, Turnstile keys.
- Create an academic year + semester with real dates/price/credits and publish it.
- Configure real provider budget and trial settings.
- Provide a support channel (WhatsApp/email) referenced by the legal pages.

## B6 — Optional launch hardening (P2/P3, owner decision)
- Add dependency-vulnerability scanning to CI.
- Commission an independent penetration test.
- Perform a budgeted load test on isolated infrastructure.
- Real-browser (Playwright) QA pass at 390/768/1440 on staging.

## Summary
| Blocker | Severity | Owner of the decision |
| --- | --- | --- |
| B1 Payment currency | P0 | Owner + provider |
| B2 Content & rights | P1 | Owner |
| B3 Deployment/staging | P1 | Owner/infra |
| B4 Legal approval | P1 | Owner + legal |
| B5 Business config | P1 | Owner |
| B6 Hardening | P2/P3 | Owner |
