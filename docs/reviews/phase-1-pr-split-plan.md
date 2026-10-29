# PR separation plan — Phase 1 vs the platform expansion

Status: **proposed, not executed**. No history was rewritten and no branch was
deleted. `main` is untouched.

## Why the branch is mixed

`feat/phase-1-ux-architecture` contains five commits that bundle one small
Phase-1 UX change together with a large platform expansion:

| Commit | Content |
| --- | --- |
| `43f57a9` | repo/build/container configuration |
| `b436ff1` | platform: onboarding, subjects, admin, billing, catalogue, landing |
| `e5ac891` | test suites + QA tooling |
| `a6d3bd4` | deploy/ops configuration and reports |
| `17597af` | PWA assets |

Rewriting this into two clean histories would require an interactive rebase across
679 files and would invalidate the pushed SHAs the review references. The current
review therefore lands the corrected Phase-1 work as an additional commit on the
same branch, and this document records the safest way to split it later if the
owner wants two separate PRs.

## Recommended split (when the owner wants it)

Do this from a scratch clone; never force-push the reviewed branch.

1. **Phase-1 branch (small, reviewable)** — `feat/phase-1-ux-only`
   Files:
   - `components/classroom/Classroom.tsx` (recognition confirmation + lint-safe hooks)
   - `tests/classroom-recognition-review.test.ts`
   - `app/(student)/app/review/page.tsx`, `components/admin/admin-shell.tsx`,
     `components/pwa/pwa-provider.tsx`, `components/student/subscription-picker.tsx`
   - `eslint.config.mjs`, `.github/workflows/ci.yml`
   - `docs/reviews/phase-1-*.md`, `docs/reviews/phase-1-screenshots/*`
   Base: `main` (`c8c2ff1`).

2. **Platform branch** — `feat/platform`
   Everything else already committed: `app/**` (except review page), `components/**`
   (except the four files above), `lib/**`, `db/**`, `schemas/**`, `drizzle/**`,
   `deploy/**`, `scripts/**`, `qa/**`, `public/**`, `README.md`, `package.json`,
   `Dockerfile`, `middleware.ts`, `next.config.ts`.

## The hard dependency to resolve first

`components/classroom/Classroom.tsx` is touched by **both** concerns: the
recognition fix (Phase 1) and platform additions (learning modes, progress,
trial chip, protected book access). Splitting the file requires separating the
Phase-1 hunks from the platform hunks — feasible but careful work.

Two safe options:

- **Option A (recommended):** keep `Classroom.tsx` in the **platform** PR and have
  the Phase-1 PR contain only the recognition behaviour plus its tests, rebased on
  top of the platform PR. Practically this means: merge platform first (after
  review), then open the small Phase-1 PR. No file is split by hand.
- **Option B:** split `Classroom.tsx` hunk-by-hunk with `git rebase -i` on a scratch
  clone, verifying `pnpm test` after each commit. Higher effort, higher risk.

Until the owner decides, the backup branch `backup/phase-1-pr1-head` and the tag
`pr1-reviewed-head` preserve the reviewed state exactly.
