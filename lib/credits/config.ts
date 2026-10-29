// Central credit configuration: tune here only, never in feature code.
export const CREDIT_COSTS = {
  tutor: 1,
  vision: 3,
  transcription: 2,
  speech: { minimum: 1, charsPerCredit: 500 },
} as const;

export function speechCredits(text: string): number {
  return Math.max(CREDIT_COSTS.speech.minimum, Math.ceil(text.length / CREDIT_COSTS.speech.charsPerCredit));
}

// V1: every monthly usage period is a fixed 30-day window.
export const CREDIT_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
