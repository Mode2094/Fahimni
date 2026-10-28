// WhatsApp is the only public contact channel. The business number is provided
// through NEXT_PUBLIC_WHATSAPP_NUMBER (international format, with or without
// "+" or spaces). No number is hardcoded and no link is rendered when the
// configured value is missing or invalid.

export const WHATSAPP_MESSAGE = 'مرحبًا، أحتاج مساعدة بخصوص منصة فهمني.';

export const WHATSAPP_ENV_KEY = 'NEXT_PUBLIC_WHATSAPP_NUMBER';

// Returns digits in wa.me format (international, no plus) or null when invalid.
export function normalizeWhatsAppNumber(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d]/g, '');
  // "00" is an international dialing prefix; wa.me expects the bare number.
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return null;
  if (/^0+$/.test(digits)) return null;
  return digits;
}

export function whatsAppHref(rawNumber: string | undefined | null, message = WHATSAPP_MESSAGE): string | null {
  const digits = normalizeWhatsAppNumber(rawNumber);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function configuredWhatsAppHref(env: NodeJS.ProcessEnv = process.env): string | null {
  return whatsAppHref(env[WHATSAPP_ENV_KEY]);
}

// Runtime resolution: the admin-managed database value wins; the environment
// variable remains as an optional bootstrap fallback. An explicitly saved
// empty value disables the channel (env fallback is only used when the admin
// has never saved a value).
export async function resolveWhatsAppNumber(): Promise<string | null> {
  const { getPlainSetting } = await import('../settings/service');
  const { SETTING_KEYS } = await import('../settings/keys');
  try {
    const stored = await getPlainSetting(SETTING_KEYS.whatsappNumber);
    if (stored !== null) return normalizeWhatsAppNumber(stored);
  } catch {
    // Database unavailable: fall through to the environment bootstrap value.
  }
  return normalizeWhatsAppNumber(process.env[WHATSAPP_ENV_KEY]);
}

export async function resolveWhatsAppHref(message = WHATSAPP_MESSAGE): Promise<string | null> {
  const digits = await resolveWhatsAppNumber();
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
