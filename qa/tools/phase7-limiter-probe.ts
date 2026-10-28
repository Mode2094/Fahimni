export {};

const { rateLimiter } = await import('../../lib/rate-limit/limiter');

process.env.REDIS_URL = 'redis://127.0.0.1:6379';
try {
  const result = await rateLimiter().consume('qa:phase7:probe', 5, 60_000);
  console.log('limiter-ok', JSON.stringify(result));
} catch (error) {
  console.log('limiter-failed', error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : 'unknown');
}
process.exit(0);
