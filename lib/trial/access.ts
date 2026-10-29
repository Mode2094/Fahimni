import type { FreeTrialRecord } from './store';

// Read-only trial access predicate mirroring the AI access rules: a trial
// grants access while it is claimed or active, unexpired and has credits left.
// Used by non-AI surfaces (textbook pages) that share the same trial grant.
export function trialAccessActive(
  trial: Pick<FreeTrialRecord, 'status' | 'remainingCredits' | 'expiresAt'> | null,
  now = new Date(),
): boolean {
  if (!trial) return false;
  if (trial.status !== 'CLAIMED' && trial.status !== 'ACTIVE') return false;
  if (trial.remainingCredits <= 0) return false;
  if (trial.expiresAt && trial.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}
