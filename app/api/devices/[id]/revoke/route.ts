import { sessionTokenFromRequest, userFromToken } from '../../../../../lib/auth/request-user';
import { loginPathFor, requestOrigin } from '../../../../../lib/auth/urls';
import { deviceStore } from '../../../../../lib/devices/store';
import { sameOrigin } from '../../../../../lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });

  const origin = requestOrigin(request);
  const user = await userFromToken(sessionTokenFromRequest(request));
  if (!user) {
    return new Response(null, { status: 303, headers: { Location: new URL(loginPathFor('/app/account'), origin).toString() } });
  }

  const { id } = await context.params;
  const removed = await deviceStore().revokeDevice(user.id, id);
  const target = new URL('/app/account', origin);
  target.searchParams.set(removed ? 'status' : 'error', removed ? 'device_removed' : 'device');
  return new Response(null, { status: 303, headers: { Location: target.toString() } });
}
