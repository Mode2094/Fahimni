import { SETTING_KEYS, SECRET_KEYS } from '../settings/keys';
import { getPlainSetting, getSecretSetting } from '../settings/service';

export type AiRuntimeConfig = {
  apiKey: string | null;
  tutorModel: string;
  visionModel: string;
  sttModel: string;
  ttsModel: string;
  voice: string;
  dailyBudgetUsd: number;
};

// Database values win over environment variables so the owner can rotate the
// key from the admin dashboard without a restart. Any settings-store failure
// falls back to the environment (the app keeps working during DB incidents).
export async function aiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): Promise<AiRuntimeConfig> {
  const [storedKey, storedModel, storedBudget] = await Promise.all([
    getSecretSetting(SECRET_KEYS.openaiApiKey).catch(() => null),
    getPlainSetting(SETTING_KEYS.aiTutorModel).catch(() => null),
    getPlainSetting(SETTING_KEYS.aiDailyBudgetUsd).catch(() => null),
  ]);
  const budget = Number.parseFloat(storedBudget ?? '');
  return {
    apiKey: storedKey?.trim() || env.OPENAI_API_KEY?.trim() || null,
    tutorModel: storedModel?.trim() || env.OPENAI_TUTOR_MODEL || 'gpt-4.1-mini',
    visionModel: env.OPENAI_VISION_MODEL || 'gpt-4.1-mini',
    sttModel: env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
    ttsModel: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    voice: env.OPENAI_VOICE || 'coral',
    dailyBudgetUsd: Number.isFinite(budget) && budget > 0 ? budget : 0,
  };
}

export async function aiConfigured(): Promise<boolean> {
  const config = await aiRuntimeConfig();
  return Boolean(config.apiKey);
}
