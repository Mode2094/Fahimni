import { readFile } from 'node:fs/promises';

import { IMAGE_MIME } from '../../../../lib/uploads/image';
import { isMediaName, mediaPath } from '../../../../lib/uploads/storage';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!isMediaName(name)) return new Response('Not found', { status: 404 });

  const extension = name.split('.').pop() ?? '';
  const contentType = IMAGE_MIME[extension];
  if (!contentType) return new Response('Not found', { status: 404 });

  try {
    const bytes = new Uint8Array(await readFile(mediaPath(name)));
    return new Response(bytes, {
      headers: {
        'content-type': contentType,
        'content-length': String(bytes.byteLength),
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
