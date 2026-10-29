// Academic-term calendar rules. Admins enter calendar dates (YYYY-MM-DD) in
// Asia/Amman; every stored boundary is the corresponding UTC instant. Jordan
// is currently fixed at UTC+3, but offsets are computed through Intl so any
// historical or future zone change stays correct.
export const ACADEMIC_TIME_ZONE = 'Asia/Amman';

const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function zoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ACADEMIC_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour') % 24, value('minute'), value('second'));
  return asUtc - (instant.getTime() - instant.getMilliseconds());
}

export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

// UTC instant for 00:00:00.000 Asia/Amman on the given calendar date.
export function ammanDayStart(calendarDate: string): Date {
  const [year, month, day] = calendarDate.split('-').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const firstPass = new Date(utcGuess - zoneOffsetMs(new Date(utcGuess)));
  // Second pass settles the offset if the first guess crossed a DST boundary.
  return new Date(utcGuess - zoneOffsetMs(firstPass));
}

// UTC instant for 23:59:59.999 Asia/Amman on the given calendar date.
export function ammanDayEnd(calendarDate: string): Date {
  return new Date(ammanDayStart(calendarDate).getTime() + 24 * 60 * 60 * 1000 - 1);
}

export type TermWindow = { startsAt: Date; endsAt: Date };

export function isValidTermWindow(startsAt: Date, endsAt: Date): boolean {
  return (
    Number.isFinite(startsAt.getTime()) &&
    Number.isFinite(endsAt.getTime()) &&
    startsAt.getTime() < endsAt.getTime()
  );
}

export type TermPhase = 'upcoming' | 'ongoing' | 'ended';

export function termPhase(startsAt: Date, endsAt: Date, now = new Date()): TermPhase {
  if (now.getTime() < startsAt.getTime()) return 'upcoming';
  if (now.getTime() > endsAt.getTime()) return 'ended';
  return 'ongoing';
}

// Contractual semester window for a purchase: access never extends past the
// configured term end; it starts at the term start when bought early, and
// immediately when bought during an ongoing term.
export function semesterAccessWindow(input: { startsAt: Date; endsAt: Date; purchasedAt: Date }): TermWindow {
  const startsAt = input.purchasedAt.getTime() > input.startsAt.getTime() ? input.purchasedAt : input.startsAt;
  return { startsAt, endsAt: input.endsAt };
}

export function daysRemaining(endsAt: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}

// Validates admin form fields ('YYYY-MM-DD' × 2) and converts them to a window.
export function termWindowFromCalendarDates(startDate: string, endDate: string): TermWindow | null {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) return null;
  const startsAt = ammanDayStart(startDate);
  const endsAt = ammanDayEnd(endDate);
  if (!isValidTermWindow(startsAt, endsAt)) return null;
  return { startsAt, endsAt };
}

export function formatTermDate(date: Date): string {
  return new Intl.DateTimeFormat('ar-JO', { timeZone: ACADEMIC_TIME_ZONE, dateStyle: 'medium' }).format(date);
}

// YYYY-MM-DD in Asia/Amman — used to prefill admin date inputs.
export function calendarDateInAmman(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ACADEMIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// The single daily accounting boundary for AI budgets: Asia/Amman midnight, so
// the reset matches the platform's operating timezone instead of UTC.
export function ammanDateKey(date: Date): string {
  return calendarDateInAmman(date);
}
