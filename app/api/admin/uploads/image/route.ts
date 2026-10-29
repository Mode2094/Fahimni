import { authorizeAdminRequest, forbidden } from '../../../../../lib/admin/http';
import { allowBookAction, bookActionKey } from '../../../../../lib/books/rate-limit';
import { MAX_IMAGE_BYTES, validateImageBytes } from '../../../../../lib/uploads/image';
import { mediaUrl, saveUploadedImage } from '../../../../../lib/uploads/storage';

export const dynamic = 'force-dynamic';

function failure(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return failure('unauthorized', 401);

  if (!allowBookAction(`image:${bookActionKey(request)}`)) return failure('rate_limited', 429);

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return failure('missing', 400);
  if (file.size > MAX_IMAGE_BYTES) return failure('too_large', 413);

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return failure('invalid_file', 400);
  }

  const validation = validateImageBytes(bytes);
  if (!validation.ok) return failure(validation.reason, validation.reason === 'too_large' ? 413 : 400);

  try {
    const name = await saveUploadedImage(bytes, validation.format);
    return Response.json({
      ok: true,
      url: mediaUrl(name),
      width: validation.width,
      height: validation.height,
    });
  } catch {
    return failure('storage', 500);
  }
}
