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
    if (process.env.NODE_TEST_CONTEXT) {
      const unref = () => (client as unknown as { stream?: { unref?: () => void } }).stream?.unref?.();
      client.on('connect', unref);
    }
    clients.set(url, client);
  }
  return client;
}
