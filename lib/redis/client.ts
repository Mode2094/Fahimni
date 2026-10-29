import { Redis } from 'ioredis';

// Shared Redis client factory for limiter/budget accounting.
//
// Do NOT use lazyConnect together with enableOfflineQueue:false: the very
// first command (and any command issued while reconnecting) is then rejected
// with "Stream isn't writeable", which surfaced in production as a spurious
// 503 config_error on the first AI request after every server start.
// Eager connect + the default offline queue means the first command simply
// waits for the connection; maxRetriesPerRequest keeps failures fast when
// Redis is actually down (callers then fail closed with config_error).
const clients = new Map<string, Redis>();

export function redisClient(url: string): Redis {
  let client = clients.get(url);
  if (!client) {
    client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      retryStrategy: (times) => Math.min(200 * times, 2_000),
    });
    // Under the node:test runner the open socket would otherwise keep the
    // process alive forever; unref lets tests exit without closing the client.
    // The socket is created on connect, so unref there (not at construction).
    // A test that awaits real Redis commands sets REA_REDIS_REFERENCED=1 so the
    // socket stays referenced: an unref'd socket lets the loop drain while a
    // command is outstanding, which the runner reports as cancelledByParent.
    // Such a test calls closeRedisClients() when it is finished.
    if (process.env.NODE_TEST_CONTEXT && process.env.REA_REDIS_REFERENCED !== '1') {
      const unref = () => (client as unknown as { stream?: { unref?: () => void } }).stream?.unref?.();
      client.on('connect', unref);
    }
    clients.set(url, client);
  }
  return client;
}

// Closes and forgets every cached client. Called by Redis integration tests so
// a shared, unref'd socket never outlives the test that created it.
export async function closeRedisClients(): Promise<void> {
  const open = [...clients.values()];
  clients.clear();
  await Promise.all(
    open.map(async (client) => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }),
  );
}
