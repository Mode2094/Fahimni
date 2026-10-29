import { authorizeAdminRequest, forbidden, redirectTo } from '../../../../../lib/admin/http';
import { checkFreemiusConnection } from '../../../../../lib/freemius/connection';
import { SECRET_KEYS, SETTING_KEYS } from '../../../../../lib/settings/keys';
import { recordSettingAudit, setPlainSetting, setSecretSetting } from '../../../../../lib/settings/service';

export const dynamic = 'force-dynamic';

function back(origin: string, params: Record<string, string>, anchor = 'freemius'): Response {
  const url = new URL('/admin/settings', origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.hash = anchor;
  return redirectTo(url);
}

// Freemius connection administration. Credentials are encrypted at rest and
// are never echoed back. Only non-empty fields are replaced so a partial form
// can never wipe a working connection.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;
  const actor = { id: auth.user.id, email: auth.user.email };

  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');

  if (intent === 'test') {
    const result = await checkFreemiusConnection();
    await setPlainSetting(SETTING_KEYS.freemiusLastVerifiedAt, new Date().toISOString(), actor);
    await setPlainSetting(
      SETTING_KEYS.freemiusLastVerifiedSummary,
      JSON.stringify({
        ok: result.ok,
        code: result.code,
        productId: result.productId,
        productTitle: result.productTitle,
        planCount: result.planCount,
        developerConfigured: result.developerConfigured,
      }),
      actor,
    );
    await recordSettingAudit({ scope: 'secret', key: SECRET_KEYS.freemiusApiKey, action: 'test', actor, detail: result.code });
    return back(auth.origin, result.ok ? { status: 'freemius_test_ok' } : { error: `freemius_${result.code}` });
  }

  if (intent === 'toggle-sync') {
    const enabled = form.get('syncEnabled') === 'on';
    await setPlainSetting(SETTING_KEYS.freemiusSyncEnabled, enabled ? 'true' : 'false', actor);
    return back(auth.origin, { status: enabled ? 'freemius_sync_enabled' : 'freemius_sync_disabled' });
  }

  if (intent === 'save') {
    const productId = String(form.get('productId') ?? '').trim();
    const developerId = String(form.get('developerId') ?? '').trim();
    const apiKey = String(form.get('apiKey') ?? '').trim();
    const secretKey = String(form.get('secretKey') ?? '').trim();
    const publicKey = String(form.get('publicKey') ?? '').trim();
    const developerSecret = String(form.get('developerSecret') ?? '').trim();

    if (productId && !/^\d{1,12}$/.test(productId)) return back(auth.origin, { error: 'freemius_product_invalid' });
    if (developerId && !/^\d{1,12}$/.test(developerId)) return back(auth.origin, { error: 'freemius_developer_invalid' });

    if (productId) await setPlainSetting(SETTING_KEYS.freemiusProductId, productId, actor);
    if (developerId) await setPlainSetting(SETTING_KEYS.freemiusDeveloperId, developerId, actor);
    if (apiKey) await setSecretSetting(SECRET_KEYS.freemiusApiKey, apiKey, actor);
    if (secretKey) await setSecretSetting(SECRET_KEYS.freemiusSecretKey, secretKey, actor);
    if (publicKey) await setSecretSetting(SECRET_KEYS.freemiusPublicKey, publicKey, actor);
    if (developerSecret) await setSecretSetting(SECRET_KEYS.freemiusDeveloperSecret, developerSecret, actor);

    return back(auth.origin, { status: 'freemius_saved' });
  }

  return back(auth.origin, { error: 'invalid' });
}
