# Phase 5 — Multi-country readiness notes (docs only, no code changes)

Status: documentation for a future expansion. Nothing here changes behavior today.

## Already country-neutral

- Curriculum structure is fully DB-driven: `grades` → `academic_fields` → `subjects` → `plans/offers`. Adding another country's grade ladder or subjects is data entry, not code.
- Money is per-record: `plans.currency`, `offers.currency`, `payments.currency` all default to `JOD` but accept any ISO code; `lib/admin/money.ts` already handles per-currency fraction digits (JOD = 3, default = 2).
- AI budgets, trial accounting and billing terms all derive day boundaries from one constant, `ACADEMIC_TIME_ZONE` (`lib/billing/terms.ts:5`), so switching the operating timezone is a one-line change (or a future per-deployment env var).
- WhatsApp support is a DB-managed setting (`resolveWhatsAppHref`), not a hardcoded link.

## Hardcoded to Jordan today (inventory)

| Location | Assumption | Extension point |
| --- | --- | --- |
| `lib/billing/terms.ts:5` | `ACADEMIC_TIME_ZONE = 'Asia/Amman'` (trial days, budgets, plan windows) | Promote to env/config; per-deployment constant |
| `lib/billing/terms.ts:86` | `Intl.DateTimeFormat('ar-JO')` display formatting | Locale per deployment setting |
| `app/layout.tsx` | `openGraph.locale = 'ar_JO'` | Locale setting |
| `lib/ai/tutor.ts:12` | System prompt: "Arabic Grade 10 mathematics teacher … Jordanian school students" | Prompt composition must become subject/grade/locale aware before serving another country/curriculum |
| `lib/ai/pedagogy.ts:21` | "Arabic natural for Jordanian students" | Same as above |
| `lib/admin/money.ts:1` | `DEFAULT_CURRENCY = 'JOD'` | Already overridable per record; only the default is Jordanian |
| DB defaults (`plans/offers/payments.currency`) | `JOD` default | Fine while Jordan-first; pass explicit currency for new markets |
| Seed/fixtures (`qa/tools/fixtures.ts`, dev fixtures) | Jordanian grades/subjects and sample math content | Data only |

## Recommended path for a second country (later, not now)

1. Add a `countries` (or `curricula`) dimension above `grades`; make grade/field/subject rows point at it.
2. Make `ACADEMIC_TIME_ZONE`, display locale and OG locale deployment settings (one row in `system_settings`).
3. Refactor the tutor/pedagogy prompts to build the "who am I teaching" paragraph from subject + grade + locale instead of a fixed Jordanian Grade-10 math sentence.
4. Currency: already per-offer; decide settlement currency with Freemius per market (see the currency note in the Phase 3 report — JOD is not a Freemius checkout currency).
5. Content: each new curriculum needs its own books; the indexing/retrieval pipeline is language-agnostic (text extraction + BM25 + fuzzy Arabic normalization — non-Arabic markets may need a tokenizer check).

## What we deliberately did NOT do

- No schema changes for multi-country (avoids speculative complexity).
- No prompt refactor (current prompt is tuned and validated for the Jordanian math experience).
- No locale plumbing (single market today).
