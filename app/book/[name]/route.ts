import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

// Legacy bundled textbook pages (Grade-10 mathematics, `data/textbook.json`).
//
// These publisher-owned images are NOT part of the subject-scoped, entitlement
// checked book pipeline (`/api/books/<id>/pages/<n>`). They shipped as plain
// static files under `public/book/`, which meant anyone with a URL could read
// copyrighted curriculum content, bypassing every access check.
//
// They are now: (1) moved out of the public web root into `assets/legacy-textbook`
// (never deleted — owner-supplied content), and (2) served only in development
// through this handler, mirroring the development-only legacy classroom at
// `app/legacy/page.tsx`. In production this route answers 404, so no legacy
// excerpt is reachable. The migration to protected subject-scoped books (or an
// explicit distribution licence) is tracked in
// `docs/reviews/phase-1-corrective-review.md`.
const LEGACY_ASSET_DIR = path.join(process.cwd(), 'assets', 'legacy-textbook');
const NAME_RE = /^\d{1,4}\.jpg$/;

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  if (process.env.NODE_ENV === 'production') return new Response('Not found', { status: 404 });

  const { name } = await context.params;
  // Strict numeric filename: no traversal, no extension tricks.
  if (!NAME_RE.test(name)) return new Response('Not found', { status: 404 });

  const filePath = path.resolve(LEGACY_ASSET_DIR, name);
  if (!filePath.startsWith(path.resolve(LEGACY_ASSET_DIR) + path.sep)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const bytes = await readFile(filePath);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
