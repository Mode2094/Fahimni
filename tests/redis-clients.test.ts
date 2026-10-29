import { test } from 'node:test';
import assert from 'node:assert/strict';

const redisUrl = process.env.REDIS_URL?.trim();

// Keep the shared Redis socket referenced for the duration of this file so the
// event loop cannot drain while a command is outstanding (the general test
// safeguard unrefs the socket, which the runner would report as a cancellation).
process.env.REA_REDIS_REFERENCED = '1';

// Opt-in regression test for the production Redis clients: the FIRST command
// must succeed after server start (previously lazyConnect + disabled offline
// queue rejected it, surfacing as a spurious 503 config_error).
//
// The shared client is unref'd under the node test runner so unrelated tests
// exit. While this test awaits real Redis commands it keeps the event loop
// alive with a referenced keep-alive timer, so unref cannot drain the loop
// mid-command (which the runner otherwise reports as cancelledByParent); it
// then closes the shared clients explicitly.
test('redis limiter and daily budget accept their first command after start', {
  skip: redisUrl ? false : 'set REDIS_URL to run the Redis integration test',
}, async () => {
  const { createRedisLimiter } = await import('../lib/rate-limit/limiter');
  const { createRedisDailyBudget } = await import('../lib/ai/budget');
  const { redisClient, closeRedisClients } = await import('../lib/redis/client');

  const keepAlive = setInterval(() => undefined, 1_000);
  try {
    const limiter = createRedisLimiter(redisUrl as string);
    const first = await limiter.consume('qa:redis-test:limiter', 3, 30_000);
    assert.equal(first.ok, true);
    const second = await limiter.consume('qa:redis-test:limiter', 3, 30_000);
    assert.equal(second.ok, true);

    const budget = createRedisDailyBudget(redisUrl as string, 'qa-redis-test');
    const reserve = await budget.reserve({ requestId: 'qa-r1', amountMicroUsd: 1_000, budgetMicroUsd: 10_000 });
    assert.equal(reserve.ok, true);
    const duplicate = await budget.reserve({ requestId: 'qa-r1', amountMicroUsd: 1_000, budgetMicroUsd: 10_000 });
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.spentMicroUsd, reserve.spentMicroUsd, 'duplicate requestId is never double-counted');
    await budget.release('qa-r1');

    const client = redisClient(redisUrl as string);
    const keys = await client.keys('qa:redis-test*');
    const dayKeys = await client.keys('*qa-redis-test*');
    const all = [...new Set([...keys, ...dayKeys])];
    if (all.length) await client.del(...all);
  } finally {
    clearInterval(keepAlive);
    // The shared client is closed so the test process can exit.
    await closeRedisClients();
  }
});
