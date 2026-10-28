# PR #1 — Corrective Engineering Review

Repository: https://github.com/Mode2094/Fahimni
Pull request: #1
Branch: `feat/phase-1-ux-architecture` (work continued on the same branch — `main` was never modified)
Base branch: `main`

## Commit references

| Ref | Commit |
| --- | --- |
| Reviewed HEAD (before this corrective work) | `17597aff220168f96c42bd867473e10612381c90` |
| Corrected HEAD | see “Corrected HEAD” note at the end of this file (filled after the corrective commit) |
| Backup branch (preserves the reviewed state) | `backup/phase-1-pr1-head` → `17597aff22…` |
| Backup tag | `pr1-reviewed-head` → `17597aff22…` |
| `main` | `c8c2ff1f4758d6457ae6630163f6701d038992b2` (unchanged) |

Both the backup branch and the tag were pushed to `origin` so the reviewed state is durable even if the feature branch is later rewritten.

## 1. Work preservation and PR separation strategy

All five original commits were analysed:

| Commit | Content | Belongs to |
| --- | --- | --- |
| `43f57a9` | repo/build/container config | Platform |
| `b436ff1` | platform: onboarding, admin, billing, catalog, landing | Platform |
| `e5ac891` | tests + QA tooling | Both |
| `a6d3bd4` | deploy/ops docs | Platform |
| `17597af` | PWA assets | Platform |

**Finding:** the branch mixed one small Phase-1 UX change (the recognition
confirmation fix) into a large platform expansion, exactly as the review noted.

**Decision (no history rewrite, nothing deleted):** the corrected work is added as
a new commit on the same branch, and the split is implemented forward:

- **Phase 1 (this PR):** `components/classroom/Classroom.tsx` (recognition
  confirmation), `tests/classroom-recognition-review.test.ts`, the lint
  correctness fixes (`app/(student)/app/review/page.tsx`,
  `components/admin/admin-shell.tsx`, `components/pwa/pwa-provider.tsx`,
  `components/student/subscription-picker.tsx`), `eslint.config.mjs`, the CI
  workflow, and this report.
- **Future platform PR:** authentication, admin console, subscriptions/billing,
  multi-subject catalogue, deployment and PWA assets (the remaining files already
  committed on this branch).

`squash`/history rewrite was rejected because it would discard five commits of
verified work and invalidate the pushed SHAs the review refers to; the backup
branch preserves the exact reviewed state either way. The safest reproducible
split (when the owner wants two clean PRs) is documented in
`docs/reviews/phase-1-pr-split-plan.md`.

## 2. Textbook replacement safety

**Defect:** `uploadBook(replace:true)` wrote straight over `source.pdf` and
`processBook` called `clearPages()` **before** extraction — a failed replacement
destroyed a working book (file, page images and index).

**Fix (staged replacement with promotion and rollback):**

- `lib/books/storage.ts`: added `stagingDir`, `stagedPdfPath`, `stagedPagesDir`,
  `writeStagedSource` (writes `staging/<token>.pdf`), `findStagedToken`,
  `discardStagedSource`, and `promoteStagedSource` — an atomic move sequence that
  puts the previous `source.pdf`/`pages/` aside, promotes the staged files, and
  **restores the previous files if any step fails**.
- `lib/books/upload.ts`: replacements are written to staging; the live source and
  the previous page counts stay untouched.
- `lib/books/indexing.ts`: extraction runs from the staged copy into staged pages;
  promotion happens only after a fully successful run; an **empty extraction never
  replaces a working book**; on failure the staged files are discarded and the
  previous `READY` state (status, page counts, sha, index) is restored, with
  `errorMessage = 'replacement_failed'`.

**New tests (failure injection + rollback):** `tests/books.test.ts`
- a failed replacement preserves the working book, its pages and its index
- a successful replacement promotes source, pages and index atomically
- extracting nothing from a replacement never replaces a working book
- promotion rolls back to the previous source and pages when a step fails

## 3. Subject-aware tutor

**Defect:** `lib/ai/tutor.ts` hard-coded *“You are a patient Arabic Grade 10
mathematics teacher”* (and a “math question … Grade 10 textbook” intent prompt),
so physics/chemistry/other subjects were taught as Grade-10 mathematics.

**Fix:** `lib/ai/pedagogy.ts` now exposes `subjectLabel()` and `tutorIdentity()`,
which build the identity from **trusted catalogue metadata** (`subject.name`
resolved server-side; sanitised to 60 chars, single line). `lib/ai/tutor.ts`
composes `${tutorIdentity(...)} ${BASE_RULES} …`, the intent prompt is
subject-aware, and the two remaining “mathematical” phrasings in the prompt were
neutralised. The route passes the trusted `subjectName`
(`app/api/tutor/route.ts`).

**New tests:**
- `tests/pedagogy.test.ts`: identity from trusted metadata; no `Grade 10`; no
  mathematics identity for chemistry; neutral fallback; label sanitisation.
- `tests/core.test.ts`: end-to-end — the composed system prompt reaches the
  provider with the math name, and the chemistry prompt contains no mathematics
  identity and no hard-coded grade.

## 4. Public textbook exposure audit

**Findings:**
1. `public/book/*` (127 legacy page images) are served statically at `/book/<n>.jpg`
   and the service worker cached `/book/`.
2. `app/api/book/route.ts` served textbook excerpts to **any** caller (no session),
   bypassing the entitlement checks used by the protected `/api/books/...` routes.

**Actions (no deletions):**
- `/api/book` now requires an authenticated session (401 otherwise) —
  `app/api/book/route.ts`; regression test added in `tests/routes.test.ts`.
- The service worker cache was bumped to `fahimni-static-v3` and `/book/` removed
  from `ASSET_PREFIXES`, so legacy pages are no longer precached/cached
  (`public/sw.js`).
- `public/book/*` and `data/textbook.json` were **not deleted**: they are still
  referenced by the legacy non-subject classroom path
  (`components/classroom/Classroom.tsx`, `lib/whiteboard/fixtures.ts`,
  `components/admin/image-field.tsx` placeholder).

**Rights / migration implications (for the owner, not decided here):** these
images are the publisher’s copyrighted textbook pages served from a public path.
Before any public launch they must either be removed (requires migrating the
legacy classroom path to the protected `/api/books/...` endpoints) or covered by
a distribution licence. Tracked as a known limitation below.

## 5. Stronger image and voice tests

`tests/classroom-recognition-review.test.ts` now covers **both** recognition
paths behaviourally (jsdom + React, real `Classroom` component):
- image → text lands in the composer, **zero** `/api/tutor` calls, send enabled,
  explicit send requests the lesson, and the request body mirrors the composer;
- audio → a full `MediaRecorder` cycle (stubbed) is transcribed once, lands in the
  composer, and never auto-submits;
- failed recognition (photo and recording) shows an Arabic error and leaves the
  composer empty;
- cancelling a recording never sends a request;
- Shift+Enter writing after recognition never submits.

The previous **source-string assertion was removed**. Because jsdom cannot drive a
React controlled input (verified: the value tracker swallows synthetic edits), the
“edited text reaches the request body” requirement is proven in a **real browser**
(`qa/tools/phase1-edited-text-browser.mjs`, evidence in
`docs/reviews/phase-1-screenshots/browser-edited-text.json`):
`typed == sentQuestion` → `bodyMatchesTyped: true`.

## 6. Payment path review

**Defect:** the legacy subject-plan checkout branch
(`app/api/checkout/route.ts`) checked only `plan.isActive && freemiusPlanId` and
would start a live checkout for an unverified or `plan_demo_*` plan. The unified
offer path was already gated.

**Fix:** the legacy branch now rejects demo plan ids and requires a **verified**
provider mapping through the same source of truth used by offers
(`offerProviderLinkStore().findByPlanId`). No real payment was enabled and no
provider API was called.

**Tests:** `tests/billing.test.ts` now asserts unverified → 409, demo id → 409
(and never reaches the provider), and a verified mapping → 200.

## 7. Lint failures resolved

Lint errors went **11 → 0** (lint now exits 0; 18 warnings remain, all listed
below). No global rule disabling was used; the React Compiler/hooks rules were
satisfied with correct patterns:

| File | Fix |
| --- | --- |
| `components/admin/admin-shell.tsx` | `useSyncExternalStore` for the localStorage sidebar preference (removed setState-in-effect; hydration-safe server snapshot) |
| `components/pwa/pwa-provider.tsx` | same external-store pattern for the install-dismiss flag |
| `components/classroom/Classroom.tsx` | effect-driven updates wrapped in `startTransition`; ref-held values mirrored into state (`canResume`, `sessionIdValue`) so render no longer reads refs |
| `app/(student)/app/review/page.tsx` | clock read moved into a helper outside the render body |
| `components/student/subscription-picker.tsx` | `window.location.href = …` → `window.location.assign(…)` |

Behaviour preservation is evidenced by the full suite (226/226) which includes the
playback, cancellation, follow-up, classroom-tools and whiteboard tests.

## 8. CI verification

`.github/workflows/ci.yml` adds a `verify` job (PostgreSQL + Redis service
containers, mock/CI-only secrets, no provider key):
`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test`
→ `pnpm build:next`, plus a `production-build-repro` job.

Real-browser UX verification is **not** automated: the repository ships no
browser-automation dependency and adding one is out of scope here. The workflow
says so explicitly and does not claim browser coverage; manual browser evidence is
committed under `docs/reviews/phase-1-screenshots/`.

## Command results (local, on the corrected HEAD)

| Command | Result |
| --- | --- |
| `pnpm typecheck` | **pass** (exit 0) |
| `pnpm lint` | **pass** (exit 0) — 0 errors, 18 warnings |
| `pnpm test` | **226 / 226 pass**, 0 fail, 0 skipped |
| `pnpm build:next` | **pass** |

### Remaining lint warnings (18, non-blocking)
- 10 × `@next/next/no-img-element` — intentional: sources are dynamic
  (`/api/media/*`, `/api/books/*/pages/*`, blob previews).
- 2 × `react-hooks/exhaustive-deps` in `Classroom.tsx` — the playback effect
  intentionally depends on stable refs; changing it risks playback regressions.
- 6 × unused vars in `qa/` one-off verification scripts (throwaway tooling).

## Remaining risks and known limitations

1. **Legacy public textbook pages** (`public/book/*`) and the bundled
   `data/textbook.json` remain publicly readable until the legacy classroom path
   is migrated to the protected endpoints. Rights/licensing must be settled by the
   owner before a public launch. *(Not fixed here deliberately — deletion would
   break the legacy path and destroy owner data.)*
2. **Not production-ready.** Freemius live checkout is intentionally blocked
   (no provider credentials); no deployment was performed; the VPS was not touched.
3. **Staged replacement** is atomic at the filesystem level (move + rollback) but
   not transactional across the database and the filesystem; a crash between the
   promotion and `replaceChunks` can leave new files with the previous index. The
   worker re-runs are idempotent, and the failure path restores the previous state
   for *extraction* failures (the case that previously destroyed books).
4. **jsdom cannot drive controlled React inputs**, so edited-text submission is
   verified in a real browser only.
5. `components/classroom/Classroom.tsx` remains a large single component; further
   extraction is recommended but was not required for these fixes.

## Confirmation

- `main` was **not** modified: `main` is still `c8c2ff1f4758d6457ae6630163f6701d038992b2`.
- Nothing was merged, deployed, or deleted; no branch was removed.
- The reviewed state is preserved at `backup/phase-1-pr1-head` / `pr1-reviewed-head`.

## Corrected HEAD

`e9b8cddd5102009313dcdbc9a0fdbc4357b5e0f7` — recorded in the corrective commit message and in the PR
update (the commit that adds this report).
