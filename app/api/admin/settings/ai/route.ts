import { authorizeAdminRequest, forbidden, redirectTo } from '../../../../../lib/admin/http';
import { testOpenAiKey } from '../../../../../lib/ai/key-test';
import { aiRuntimeConfig } from '../../../../../lib/ai/runtime-config';
import { SECRET_KEYS, SETTING_KEYS } from '../../../../../lib/settings/keys';
import { deleteSecretSetting, getSecretSetting, recordSettingAudit, setPlainSetting, setSecretSetting } from '../../../../../lib/settings/service';

export const dynamic = 'force-dynamic';

function back(origin: string, params: Record<string, string>, anchor = 'ai'): Response {
  const url = new URL('/admin/settings', origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.hash = anchor;
  return redirectTo(url);
}

const MODEL_RE = /^[a-zA-Z0-9._-]{1,64}$/;

// AI provider administration: rotate the OpenAI key (validated before it is
// ever stored), adjust the tutor model, and set a global daily spend limit.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;
  const actor = { id: auth.user.id, email: auth.user.email };

  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');

  if (intent === 'test-key') {
    const candidate = String(form.get('apiKey') ?? '').trim() || (await getSecretSetting(SECRET_KEYS.openaiApiKey)) || process.env.OPENAI_API_KEY?.trim() || '';
    if (!candidate) return back(auth.origin, { error: 'ai_key_missing' });
    const result = await testOpenAiKey(candidate);
    await setPlainSetting(SETTING_KEYS.aiLastTestAt, new Date().toISOString(), actor);
    await setPlainSetting(SETTING_KEYS.aiLastTestOk, result.ok ? 'true' : 'false', actor);
    await recordSettingAudit({ scope: 'secret', key: SECRET_KEYS.openaiApiKey, action: 'test', actor, detail: result.code });
    if (result.ok) return back(auth.origin, { status: 'ai_test_ok' });
    return back(auth.origin, { error: result.code === 'invalid' ? 'ai_key_invalid' : 'ai_key_unverified' });
  }

  if (intent === 'clear-key') {
    await deleteSecretSetting(SECRET_KEYS.openaiApiKey, actor);
    return back(auth.origin, { status: 'ai_key_cleared' });
  }

  if (intent === 'save') {
    const candidate = String(form.get('apiKey') ?? '').trim();
    const model = String(form.get('tutorModel') ?? '').trim();
    const budgetRaw = String(form.get('dailyBudgetUsd') ?? '0').trim();
    const budget = Number.parseFloat(budgetRaw);

    if (model && !MODEL_RE.test(model)) return back(auth.origin, { error: 'ai_model_invalid' });
    if (!Number.isFinite(budget) || budget < 0 || budget > 100_000) return back(auth.origin, { error: 'ai_budget_invalid' });

    if (candidate) {
      // A candidate key is only stored after the provider confirms it. A
      // failed validation never overwrites a working key.
      const result = await testOpenAiKey(candidate);
      await setPlainSetting(SETTING_KEYS.aiLastTestAt, new Date().toISOString(), actor);
      await setPlainSetting(SETTING_KEYS.aiLastTestOk, result.ok ? 'true' : 'false', actor);
      if (!result.ok) {
        return back(auth.origin, { error: result.code === 'invalid' ? 'ai_key_invalid' : 'ai_key_unverified' });
      }
      await setSecretSetting(SECRET_KEYS.openaiApiKey, candidate, actor);
    }

    await setPlainSetting(SETTING_KEYS.aiTutorModel, model, actor);
    await setPlainSetting(SETTING_KEYS.aiDailyBudgetUsd, budget > 0 ? String(budget) : '0', actor);
    // Keep the runtime config in sync immediately (no restart needed).
    await aiRuntimeConfig().catch(() => null);
    return back(auth.origin, { status: candidate ? 'ai_key_saved' : 'ai_settings_saved' });
  }

  return back(auth.origin, { error: 'invalid' });
}
