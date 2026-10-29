# PR #1 — Corrective Engineering Review

Repository: https://github.com/Mode2094/Fahimni
Pull request: #1
Branch: `feat/phase-1-ux-architecture` (work continued on the same branch — `main` was never modified)
Base branch: `main`

## Commit references

| Ref | Commit |
| --- | --- |
| Reviewed HEAD (before this corrective work) | `17597aff220168f96c42bd867473e10612381c90` |
| First corrective commit (superseded) | `a535ba1af764ed23a13811762c8295d5831fd1df` |
| **Final HEAD (this pass)** | **`d31070bc6bc30c30e94a4156c97d047429ba2201`** |
| Backup branch (preserves the originally reviewed state) | `backup/phase-1-pr1-head` → `17597aff22…` |
| Backup tag | `pr1-reviewed-head` → `17597aff22…` |
| `main` | `c8c2ff1f4758d6457ae6630163f6701d038992b2` (unchanged) |

The corrective work is three commits on the same branch, none of which rewrites
history:

1. `04113f0` — CI pnpm setup fix, safe pending-replacement lifecycle, legacy
   textbook access closure.
2. `5fdc99c` — isolate the learning-progress store for the tutor gate.
3. `d31070b` — explicit AI/Redis test doubles so Node 22 CI is deterministic.

> **Note on an earlier revision of this report:** a previous version referenced a
> "corrected HEAD" of `e9b8cddd5102009313dcdbc9a0fdbc4357b5e0f7`. That commit does
> not exist in this repository; it was a placeholder that was never replaced. It
> is corrected here to the actual final SHA above.

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

**Defect (first pass):** `uploadBook(replace:true)` wrote straight over
`source.pdf` and `processBook` called `clearPages()` **before** extraction — a
failed replacement destroyed a working book (file, page images and index).

A staged replacement was added, but it still set the book's `status` to
`UPLOADED` while a replacement was pending, which removed the book from
`findReadyBookBySubject()` — students lost access to a perfectly valid book for
the duration of the replacement, and a crash in that window left the book
invisible. Replacement selection also relied on lexicographically sorting random
UUID directory names, which is meaningless across concurrent replacements.

**Fix (safe pending-replacement lifecycle, final HEAD):**

- **Schema:** `books.pending_staged_token` + `books.pending_staged_at`
  (`drizzle/0011_lumpy_king_bedlam.sql`). The active version (status, sha256,
  page counts, chunks) is **never** touched while a replacement is pending, so
  `findReadyBookBySubject()` keeps returning the previous READY book.
- **`lib/books/store.ts`:**
  - `stageReplacement(bookId, token)` — a conditional update that only succeeds
    while `pending_staged_token IS NULL`, so two concurrent replacements can
    never claim the same book.
  - `clearPendingReplacement(bookId, token)` — clears only the matching token, so
    a slow worker cannot erase a newer pending replacement.
  - `replaceChunks(..., expectedPendingToken?)` — the chunk swap and the clearing
    of the pending marker commit in **one transaction** guarded by
    `pending_staged_token = expectedPendingToken`; a superseded worker commits
    nothing.
  - `claimNextUploadedBook()` now also claims a `READY` book with a pending
    replacement (keeping it `READY`), and `resetStaleProcessing()` only recovers
    brand-new `PROCESSING` books (a replacement is never left in `PROCESSING`).
- **`lib/books/upload.ts`:** a replacement is written to isolated versioned
  storage (`staging/<token>.pdf`, `staging/<token>-pages/`) and recorded via
  `stageReplacement`. The book's status and the live source/pages/index stay
  untouched. A second concurrent replacement returns `busy` (new admin message)
  without deleting the first.
- **`lib/books/indexing.ts`:** the token is read from the database, never from
  sorting directory names. Extraction runs from the staged copy; promotion
  happens only after a fully successful run; an empty extraction never replaces a
  working book; on failure the staged files are dropped and the pending marker is
  cleared, leaving the previous READY book exactly as it was.
- **Crash recovery:** `recoverOrphanedStaging()` (called on worker start) removes
  staged copies that no book is tracking (a crash between the file write and the
  database write), and keeps a tracked pending replacement for re-processing.

**New tests (`tests/books-replacement-lifecycle.test.ts`, 8) — all pass:**
- a book stays READY and available while a replacement is pending *and* while it
  is processed;
- replacement content is indexed into isolated versioned storage, then source,
  pages and index switch together and the marker clears;
- the active version is never chosen by sorting random UUIDs;
- a second concurrent replacement is refused without deleting the first;
- a superseded worker cannot publish over a newer pending replacement;
- recovery after a worker restart removes orphaned staging and keeps the tracked
  one;
- a database failure while staging leaves the working book untouched and freed
  for retry;
- a replacement whose staged file vanished is treated as a re-index of the live
  source, never a promotion.

Existing `tests/books.test.ts` replacement tests were updated to assert on the
tracked pending token instead of a scanned directory. `tests/books-db.test.ts`
(the PostgreSQL integration test) now exercises the pending claim, the
single-pending rule and the token-guarded commit against real PostgreSQL.

**Atomicity honesty:** this is **not** one atomic transaction. The database
commit (chunk swap + marker clear) is atomic; filesystem promotion is a sequence
of renames with rollback, and the switch is ordered so the database is only
updated after the files are in place and consistent. A crash between the file
rename and the database commit is recovered by the worker: the pending marker is
still set, so the book is re-processed and the commit re-attempted.

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

## 4. Public textbook exposure audit and closure

**Findings (as reviewed):**
1. `public/book/*` (127 legacy page images) were served statically at
   `/book/<n>.jpg` and the service worker cached `/book/`.
2. `app/api/book/route.ts` served textbook excerpts to **any** caller (no session),
   bypassing the entitlement checks used by the protected `/api/books/...` routes.
   A session was added, but **a session is not subject entitlement** — a signed-in
   student with no access to the subject could still read protected excerpts.

**Fix (final HEAD) — the whole legacy path is now development-only, consistent
with the legacy classroom page:**

- `app/legacy/page.tsx` already redirects to `/` in production; the two endpoints
  below now match it.
- `app/api/book/route.ts`: the bundled-excerpt endpoint returns **404 in
  production** for every caller (student or admin). In development it still
  requires an authenticated session (defence in depth).
- `public/book/*` was **moved** (not deleted) to `assets/legacy-textbook/`
  outside the public web root, and is served only by the new
  `app/book/[name]/route.ts`, which returns **404 in production** and, in
  development, enforces a strict numeric filename, a path-containment check, and
  `Cache-Control: no-store`. `git mv` preserves the files and their history.
- `middleware.ts`: `/book/` is no longer excluded from the matcher, so security
  headers now apply to the route; `public/sw.js` no longer caches any book path.
- The referenced-by code (`components/classroom/Classroom.tsx`,
  `lib/whiteboard/fixtures.ts`, `components/admin/image-field.tsx`) keeps using
  the same `/book/<n>.jpg` URLs, which remain valid in development.

**New tests (`tests/legacy-book-access.test.ts`, 4) — all pass:**
- the excerpt endpoint refuses anonymous callers;
- a signed-in **student** is served in development but gets **404 in production**;
- an **administrator** also gets **404 in production** (role never widens it);
- legacy page images are 404 in production and served with `no-store` in
  development, and the route rejects traversal and non-numeric names.

**Migration plan for the owner (not performed here):** the durable fix is to make
the legacy classroom path read from the entitlement-checked subject book
pipeline (`/api/books/<id>/pages/<n>`, `subjectRetriever`) so the bundled Grade-10
book becomes a normal subject book. Until that happens the legacy surface stays
development-only, so no protected content is reachable in production.

**Distribution rights decision still required (owner, not decided here):** the
127 page images and `data/textbook.json` are the **publisher's copyrighted
textbook pages**. Before any public launch the owner must either (a) complete the
migration above and confirm the platform's licence to serve this content to
entitled students, or (b) obtain a distribution licence, or (c) remove the
content. **No copyrighted or owner-supplied content was deleted in this pass.**

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

Behaviour preservation is evidenced by the full suite (238/238) which includes the
playback, cancellation, follow-up, classroom-tools and whiteboard tests.

## 7a. Verified improvements preserved (no regressions)

This pass deliberately touched none of the following, and the suite proves each
still works after the changes:

| Preserved behaviour | Evidence |
| --- | --- |
| Manual confirmation after image recognition | `tests/classroom-recognition-review.test.ts` — image recognition lands in the composer, **zero** `/api/tutor` calls, never auto-submits |
| Manual confirmation after speech transcription | same file — a full `MediaRecorder` cycle transcribes once, lands in the composer, never auto-submits |
| Subject-specific tutor identity | `tests/pedagogy.test.ts` + `tests/core.test.ts` — identity from trusted catalogue metadata, no Grade-10 mathematics identity for chemistry |
| Verified Freemius checkout restrictions | `tests/billing.test.ts` — unverified → 409, demo id → 409, verified mapping → 200 |
| Playback and cancellation behaviour | `tests/playback.test.ts`, `tests/classroom-tools.test.ts`, `tests/classroom.test.ts` |
| Existing student and admin functionality | `tests/student*.test.ts`, `tests/admin*.test.ts`, `tests/routes.test.ts` |
| Zero ESLint errors | `pnpm lint` exits 0 (18 pre-existing warnings, unchanged) |

## 8. CI verification

`.github/workflows/ci.yml` runs a `verify` job (PostgreSQL + Redis service
containers, mock/CI-only secrets, no provider key):
`pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test`
→ `pnpm build:next`, plus a `production-build-repro` job.

**The original GitHub Actions run failed before running any test.** Run
`40774016401` failed at `pnpm/action-setup@v4` with *“Multiple versions of pnpm
specified”* — the action's `version: 11` conflicted with `packageManager:
pnpm@11.25.0` in `package.json`. Both `pnpm/action-setup` steps now omit
`version`, so the version comes from `package.json` only.

A second real failure surfaced once the tests actually ran: under the Node 22
runner the tutor/AI pipeline opened real Redis/database handles that outlived the
awaiting test, so the runner cancelled sibling tests
(`cancelledByParent: 'Promise resolution is still pending…'`). The
provider runtime-config read, the global/trial daily budgets, the rate limiter
and the learning-progress read now go through the repository's existing test
seams in the affected suites, and the one Redis integration test keeps its socket
referenced and closes the clients in a `finally`. The full suite was reproduced
locally and in CI on Node 22 against real PostgreSQL + Redis.

Real-browser UX verification is **not** automated: the repository ships no
browser-automation dependency and adding one is out of scope here. The workflow
says so explicitly and does not claim browser coverage; manual browser evidence is
committed under `docs/reviews/phase-1-screenshots/`.

## Command results

### GitHub Actions (authoritative) — final HEAD `d31070bc…`

| Ref | Result |
| --- | --- |
| Run URL | https://github.com/Mode2094/Fahimni/actions/runs/40912746003 |
| `install · test · typecheck · lint · build` | **success** |
| `production build (reproducibility)` | **success** |

Earlier failed runs, for the record:
- https://github.com/Mode2094/Fahimni/actions/runs/40774016401 — failed at
  `pnpm/action-setup@v4` (multiple pnpm versions).
- https://github.com/Mode2094/Fahimni/actions/runs/40904776798 — tests ran, Node 22
  `cancelledByParent`.
- https://github.com/Mode2094/Fahimni/actions/runs/40905958961 — partial fix, same
  cancel.

### Local (final HEAD `d31070bc…`)

| Command | Result |
| --- | --- |
| `pnpm typecheck` | **pass** (exit 0) |
| `pnpm lint` | **pass** (exit 0) — 0 errors, 18 warnings |
| `pnpm test` | **238 / 238 pass**, 0 fail, 0 skipped (also 238/238 on Node 22 with real PostgreSQL + Redis, 3 consecutive runs) |
| `pnpm build:next` | **pass** |

These are local results; the GitHub Actions results above are the authoritative
CI evidence. The local run and CI were both performed on Node 22 with real
PostgreSQL and Redis service containers, so they exercise the same paths.

### Remaining lint warnings (18, non-blocking)
- 10 × `@next/next/no-img-element` — intentional: sources are dynamic
  (`/api/media/*`, `/api/books/*/pages/*`, blob previews) or the legacy
  development-only page route.
- 2 × `react-hooks/exhaustive-deps` in `Classroom.tsx` — the playback effect
  intentionally depends on stable refs; changing it risks playback regressions.
- 6 × unused vars in `qa/` one-off verification scripts (throwaway tooling).

## Remaining risks and known limitations

1. **Legacy textbook distribution rights** — the 127 page images and
   `data/textbook.json` are publisher-copyrighted content. They are no longer
   publicly reachable (the entire legacy surface is development-only), but public
   distribution still requires either the migration to the protected subject book
   pipeline with a confirmed licence, an explicit distribution licence, or removal.
   This decision is the owner's and has not been made here; **no content was
   deleted.**
2. **Not production-ready.** Freemius live checkout is intentionally blocked
   (no provider credentials); no deployment was performed; the VPS was not touched.
3. **Replacement switch is not one atomic transaction.** The database commit
   (chunk swap + pending-marker clear) is atomic and token-guarded; filesystem
   promotion is a sequence of renames with rollback, ordered so the database is
   only updated once the files are consistent. A crash mid-promotion is recovered
   by the worker because the pending marker is still set, so the replacement is
   re-processed and re-committed; no state mixes old index with new files.
4. **jsdom cannot drive controlled React inputs**, so edited-text submission is
   verified in a real browser only.
5. `components/classroom/Classroom.tsx` remains a large single component; further
   extraction is recommended but was not required for these fixes.

## Confirmation

- `main` was **not** modified: `main` is still `c8c2ff1f4758d6457ae6630163f6701d038992b2`.
- Nothing was merged or deployed; no branch was deleted; no copyrighted or
  owner-supplied content was deleted (the legacy images were moved with `git mv`).
- The reviewed state is preserved at `backup/phase-1-pr1-head` / `pr1-reviewed-head`.

## Final HEAD

`d31070bc6bc30c30e94a4156c97d047429ba2201` — the head of
`feat/phase-1-ux-architecture`, verified green in GitHub Actions run
https://github.com/Mode2094/Fahimni/actions/runs/40912746003.
