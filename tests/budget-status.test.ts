import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
delete process.env.REDIS_URL;

import { aiBudget, createMemoryDailyBudget, memoryBudgetSpent } from '../lib/ai/budget';
import { budgetResetsAt, aiBudgetStatus } from '../lib/ai/budget-status';
import { createMemoryTrialBudget, memoryTrialSpent } from '../lib/trial/budget';
import { ammanDateKey, ammanDayStart } from '../lib/billing/terms';

test('the daily accounting boundary is Asia/Amman midnight, not UTC', () => {
  // 21:30 UTC is already the next day in Amman (UTC+3).
  const lateUtc = new Date('2026-10-09T21:30:00Z');
  assert.equal(ammanDateKey(lateUtc), '2026-10-10');
  const resetsAt = budgetResetsAt(lateUtc);
  assert.equal(resetsAt.getTime(), ammanDayStart('2026-10-11').getTime());
  // A normal UTC time keeps the same calendar day.
  assert.equal(ammanDateKey(new Date('2026-10-09T10:00:00Z')), '2026-10-09');
});

test('memory budget counters survive lookups and never double-count a requestId', async () => {
  const budget = createMemoryDailyBudget('ai-test-status');
  await budget.reserve({ requestId: 'r1', amountMicroUsd: 30_000, budgetMicroUsd: 1_000_000 });
  await budget.reserve({ requestId: 'r1', amountMicroUsd: 30_000, budgetMicroUsd: 1_000_000 });
  assert.equal(memoryBudgetSpent('ai-test-status'), 30_000);
  await budget.release('r1');
  assert.equal(memoryBudgetSpent('ai-test-status'), 0);

  const trial = createMemoryTrialBudget();
  await trial.reserve({ requestId: 't1', amountMicroUsd: 10_000, budgetMicroUsd: 1_000_000 });
  assert.equal(memoryTrialSpent(), 10_000);
  await trial.release('t1');
  assert.equal(memoryTrialSpent(), 0);
});

test('the status report reads the same counters the limiter uses (memory mode)', async () => {
  // The global singleton and the status peek share one registry per prefix.
  await aiBudget({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).reserve({
    requestId: 'status-1',
    amountMicroUsd: 40_000,
    budgetMicroUsd: 1_000_000,
  });
  const status = await aiBudgetStatus();
  assert.equal(status.source, 'memory');
  assert.equal(status.dayKey, ammanDateKey(new Date()));
  assert.ok(status.global.spentUsd >= 0.04);
  assert.equal(status.global.limitUsd, 0, 'no configured limit reads as 0 (unlimited)');
});

test('a configured limit blocks reservations atomically in memory mode', async () => {
  const budget = createMemoryDailyBudget('ai-limit-test');
  const first = await budget.reserve({ requestId: 'a', amountMicroUsd: 700_000, budgetMicroUsd: 1_000_000 });
  assert.equal(first.ok, true);
  const second = await budget.reserve({ requestId: 'b', amountMicroUsd: 700_000, budgetMicroUsd: 1_000_000 });
  assert.equal(second.ok, false);
  // A limit of zero is documented as unlimited and is enforced by the caller,
  // never by this primitive (which always receives the resolved cap).
  const released = await budget.reserve({ requestId: 'a', amountMicroUsd: 700_000, budgetMicroUsd: 1_000_000 });
  assert.equal(released.ok, true, 'same requestId is idempotent');
});

test('controlled concurrency: parallel reservations never exceed the daily cap (SIMULATED)', async () => {
  const budget = createMemoryDailyBudget('ai-concurrency-test');
  const cap = 500_000;
  const amount = 60_000;
  // 20 concurrent requests against a cap that fits exactly 8 reservations.
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) => budget.reserve({ requestId: `req-${index}`, amountMicroUsd: amount, budgetMicroUsd: cap })),
  );
  const accepted = results.filter((result) => result.ok).length;
  const rejected = results.filter((result) => !result.ok).length;
  assert.equal(accepted, 8);
  assert.equal(rejected, 12);
  assert.equal(memoryBudgetSpent('ai-concurrency-test'), 8 * amount);
  assert.ok(memoryBudgetSpent('ai-concurrency-test') <= cap);

  // A duplicate requestId under concurrency is never double-counted.
  const duplicate = await budget.reserve({ requestId: 'req-0', amountMicroUsd: amount, budgetMicroUsd: cap });
  assert.equal(duplicate.ok, true);
  assert.equal(memoryBudgetSpent('ai-concurrency-test'), 8 * amount);

  // Releasing failed/aborted requests frees capacity for the next request.
  await budget.release('req-1');
  assert.equal(memoryBudgetSpent('ai-concurrency-test'), 7 * amount);
  const afterRelease = await budget.reserve({ requestId: 'req-next', amountMicroUsd: amount, budgetMicroUsd: cap });
  assert.equal(afterRelease.ok, true);
});

test('controlled concurrency: the trial budget enforces its own cap in parallel (SIMULATED)', async () => {
  const trial = createMemoryTrialBudget();
  const cap = 100_000;
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, index) => trial.reserve({ requestId: `trial-${index}`, amountMicroUsd: 25_000, budgetMicroUsd: cap })),
  );
  assert.equal(results.filter((result) => result.ok).length, 4);
  assert.equal(memoryTrialSpent(), 100_000);
});
