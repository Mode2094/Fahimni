# Phase 1 — Professional UX & Architecture Improvement (report)

Repository: https://github.com/Mode2094/Madar-Math-Tutor (renamed → Fahimni after this phase)
Branch: `feat/phase-1-ux-architecture`
Base SHA: `c8c2ff1f4758d6457ae6630163f6701d038992b2`

## Scope delivered

### 1. Image/voice recognition must be reviewed before a lesson (functional fix)
**Before:** `POST /api/vision` and `POST /api/transcribe` results were written into the
composer **and immediately submitted** (`setQuestion(...); await ask(...)`), so a lesson
was requested without the student ever confirming the recognised text.
**After:** the recognised text is placed in the composer for **review and editing**; the
composer is focused, the attachment context shows «راجع السؤال ثم أرسله», and the student
sends it themselves. No automatic request is made.
Files: `components/classroom/Classroom.tsx` (both recognition handlers + composer context).

### 2. Lint configuration defect fixed
`pnpm lint` was linting the generated `.next-native` build output (the project's `distDir`),
producing noise from bundled code instead of project sources.
Files: `eslint.config.mjs` (added `.next-native/**`, `.data/**`, `.wrangler/**`, `dist/**`).

### 3. Lint errors reduced (21 → 11) and warnings (26 → 18)
Safe, behaviour-preserving fixes: unused imports (`speechNarration`, `freemiusCredentials`,
`BoardState`, `ProviderError`), `prefer-const` (`lib/ai/math-check.ts`, `tests/routes.test.ts`),
removed `any` in `lib/ai/provider.ts` (now a typed `ChatCompletionResponse`) and in
`tests/core.test.ts` / `tests/routes.test.ts`, unused binding in `tests/subscriptions-db.test.ts`,
stale eslint-disable removed, and the landing FAQ now reads the real `maxDevices` setting
instead of hard-coding “جهازين”.

## Verification

| Check | Result |
| --- | --- |
| `pnpm test` | see Test results below |
| `pnpm typecheck` | **pass** (0 errors) |
| `pnpm lint` | **fails: 11 errors, 18 warnings** (all pre-existing, listed below) |
| `pnpm build:next` | **pass** |

> The project uses pnpm (pnpm-lock.yaml), so the npm commands requested were run through
> their pnpm equivalents (`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build:next`).

## Tests added

`tests/classroom-recognition-review.test.ts`
- **an image question is recognised into the composer and never auto-submitted** — mounts the
  real `Classroom` in jsdom, drives the file input with a fake image, stubs `/api/vision`,
  and asserts: the recognised text lands in the textarea, **zero `/api/tutor` calls** happen,
  the send button is enabled, the text can still be edited, and only an explicit click sends.
- **the source never submits a recognised question automatically** — regression guard against
  reintroducing the auto-submit call.

## Known remaining problems (not fixed in this phase)

### Lint errors — React Compiler / hooks rules (pre-existing)
| File | Line | Rule |
| --- | --- | --- |
| `app/(student)/app/review/page.tsx` | 37 | impure function during render |
| `components/admin/admin-shell.tsx` | 25 | setState synchronously in effect |
| `components/classroom/Classroom.tsx` | 22, 53, 60, 102 | setState synchronously in effect |
| `components/classroom/Classroom.tsx` | 143, 153 | refs accessed during render |
| `components/pwa/pwa-provider.tsx` | 77 | setState synchronously in effect |
| `components/student/subscription-picker.tsx` | 95 | value cannot be modified |

These live in the shipped playback/UI engine. Correcting them is a real refactor with a
regression risk to audio playback, cancellation and follow-ups — explicitly out of scope for
this phase, which requires **no** regressions in those areas. Recommended as a dedicated phase.

### Other observations
- `<img>` warnings are intentional: sources are dynamic (`/api/media/*`, `/api/books/*/pages/*`,
  blob previews), where `next/image` optimisation is not applicable.
- `components/classroom/Classroom.tsx` remains a single large component; further extraction
  into focused hooks is recommended but was not required to satisfy the functional goals here.
- The original `app/page.tsx` is now the marketing landing page; the classroom already lives in
  `components/classroom/Classroom.tsx` with `hooks/usePlayback` — i.e. the requested split of a
  monolithic page into components/hooks was already in place in this branch's ancestry.

## Notes for reviewers
- No fake AI responses in production, no client-side secrets, provider unchanged, no curriculum
  or superscription changes, no new dependencies, no auth/subscriptions/multi-subject work.
- Mobile/desktop/browser evidence: see “browser verification” section of the phase summary.
