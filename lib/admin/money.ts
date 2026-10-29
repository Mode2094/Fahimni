export const DEFAULT_CURRENCY = 'JOD';

const FRACTION_DIGITS: Record<string, number> = {
  JOD: 3,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  USD: 2,
  EUR: 2,
};

export function fractionDigitsFor(currency: string): number {
  return FRACTION_DIGITS[currency.trim().toUpperCase()] ?? 2;
}

// Parses an admin-entered amount ("39.5") into integer minor units (39500 fils)
// without ever passing through floating point.
export function parseMoneyToMinor(input: string | null | undefined, currency = DEFAULT_CURRENCY): number | null | 'invalid' {
  if (input === null || input === undefined) return null;
  const value = input.trim();
  if (!value) return null;
  const digits = fractionDigitsFor(currency);
  const match = new RegExp(`^(\\d{1,9})(?:\\.(\\d{1,${digits}}))?$`).exec(value);
  if (!match) return 'invalid';
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(digits, '0'));
  return whole * 10 ** digits + fraction;
}

export function formatMinorAmount(minor: number | null | undefined, currency = DEFAULT_CURRENCY): string {
  if (minor === null || minor === undefined) return '';
  const digits = fractionDigitsFor(currency);
  const factor = 10 ** digits;
  const whole = Math.trunc(minor / factor);
  const fraction = String(minor % factor).padStart(digits, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export function formatMinor(minor: number | null | undefined, currency = DEFAULT_CURRENCY): string {
  if (minor === null || minor === undefined) return '—';
  const amount = formatMinorAmount(minor, currency);
  return `${amount} ${currency.trim().toUpperCase() === 'JOD' ? 'د.أ' : currency.trim().toUpperCase()}`;
}
