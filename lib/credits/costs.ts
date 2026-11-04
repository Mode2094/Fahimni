import { CREDIT_COSTS, speechCredits } from '../credits/config';
import { getPlainSetting, setPlainSetting, type SettingActor } from '../settings/service';

// Admin-configurable per-service credit costs. Defaults come from the central
// `lib/credits/config.ts`; the admin may tune each within validated bounds.
// Costs are always resolved server-side and never trusted from the client.

export type AiServiceKey = 'tutor' | 'vision' | 'transcription' | 'speech' | 'followup';

export const AI_SERVICE_KEYS: AiServiceKey[] = ['tutor', 'vision', 'transcription', 'speech', 'followup'];

// Safe bounds: at least 1 credit and never more than 50 for a single call, so a
// misconfiguration cannot silently drain a student's wallet.
export const CREDIT_COST_BOUNDS: Record<AiServiceKey, { min: number; max: number }> = {
  tutor: { min: 1, max: 20 },
  vision: { min: 1, max: 50 },
  transcription: { min: 1, max: 50 },
  speech: { min: 1, max: 20 },
  followup: { min: 1, max: 20 },
};

export const DEFAULT_CREDIT_COSTS: Record<AiServiceKey, number> = {
  tutor: CREDIT_COSTS.tutor,
  vision: CREDIT_COSTS.vision,
  transcription: CREDIT_COSTS.transcription,
  speech: CREDIT_COSTS.speech.minimum,
  followup: CREDIT_COSTS.tutor,
};

export const AI_SERVICE_LABELS: Record<AiServiceKey, string> = {
  tutor: 'شرح نصي على السبورة',
  vision: 'تعرّف على سؤال من صورة',
  transcription: 'تحويل سؤال صوتي إلى نص',
  speech: 'توليد شرح صوتي',
  followup: 'سؤال متابعة',
};

const SETTING_PREFIX = 'creditCost.';

function settingKey(service: AiServiceKey): string {
  return `${SETTING_PREFIX}${service}`;
}

export function isAiServiceKey(value: string): value is AiServiceKey {
  return (AI_SERVICE_KEYS as string[]).includes(value);
}

// Validates an admin-entered cost against the bounds. Returns the parsed
// integer, the string 'invalid', or null when the field was left empty.
export function parseCreditCost(service: AiServiceKey, raw: string | null | undefined): number | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d{1,3}$/.test(value)) return 'invalid';
  const parsed = Number(value);
  const bounds = CREDIT_COST_BOUNDS[service];
  if (parsed < bounds.min || parsed > bounds.max) return 'invalid';
  return parsed;
}

// Reads the effective cost table, falling back to defaults for any service that
// has no stored value or whose stored value is out of bounds.
export async function creditCostTable(): Promise<Record<AiServiceKey, number>> {
  const entries = await Promise.all(
    AI_SERVICE_KEYS.map(async (service) => {
      const stored = await getPlainSetting(settingKey(service)).catch(() => null);
      const parsed = parseCreditCost(service, stored);
      return [service, typeof parsed === 'number' ? parsed : DEFAULT_CREDIT_COSTS[service]] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<AiServiceKey, number>;
}

export async function creditCostFor(service: AiServiceKey): Promise<number> {
  const table = await creditCostTable();
  return table[service];
}

export async function setCreditCost(service: AiServiceKey, value: number, actor: SettingActor = null): Promise<void> {
  if (parseCreditCost(service, String(value)) === 'invalid') throw new Error('invalid_credit_cost');
  await setPlainSetting(settingKey(service), String(value), actor);
}

// Speech cost is text-size based; it scales the configured per-block cost. The
// block size stays fixed (500 chars) so admins tune the unit, not the algebra.
export function speechCreditCost(text: string, unitCost: number): number {
  const blocks = Math.ceil(text.length / CREDIT_COSTS.speech.charsPerCredit);
  return Math.max(unitCost, blocks * unitCost);
}

export { speechCredits };
