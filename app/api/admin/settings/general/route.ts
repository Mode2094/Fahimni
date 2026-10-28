import { authorizeAdminRequest, forbidden, redirectTo } from '../../../../../lib/admin/http';
import { normalizeWhatsAppNumber } from '../../../../../lib/contact/whatsapp';
import { SETTING_KEYS } from '../../../../../lib/settings/keys';
import { setPlainSetting } from '../../../../../lib/settings/service';

export const dynamic = 'force-dynamic';

function back(origin: string, params: Record<string, string>, anchor = 'general'): Response {
  const url = new URL('/admin/settings', origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.hash = anchor;
  return redirectTo(url);
}

// General public settings: platform name and the support WhatsApp number.
// The WhatsApp value is normalized server-side and stored as the runtime
// source of truth; an explicitly saved empty value disables the channel.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');

  if (intent === 'platform-name') {
    const name = String(form.get('platformName') ?? '').trim();
    if (name.length < 2 || name.length > 40) return back(auth.origin, { error: 'platform_name_invalid' });
    await setPlainSetting(SETTING_KEYS.platformName, name, { id: auth.user.id, email: auth.user.email });
    return back(auth.origin, { status: 'platform_saved' });
  }

  if (intent === 'whatsapp-disable') {
    await setPlainSetting(SETTING_KEYS.whatsappNumber, '', { id: auth.user.id, email: auth.user.email });
    return back(auth.origin, { status: 'whatsapp_disabled' }, 'whatsapp');
  }

  if (intent === 'whatsapp-save') {
    const raw = String(form.get('whatsappNumber') ?? '');
    const normalized = normalizeWhatsAppNumber(raw);
    if (!normalized) return back(auth.origin, { error: 'whatsapp_invalid' }, 'whatsapp');
    await setPlainSetting(SETTING_KEYS.whatsappNumber, normalized, { id: auth.user.id, email: auth.user.email });
    return back(auth.origin, { status: 'whatsapp_saved' }, 'whatsapp');
  }

  return back(auth.origin, { error: 'invalid' });
}
