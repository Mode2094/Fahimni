export {};

// Retention pass for operational data. Safe to run repeatedly (idempotent).
// Recommended on the server: a daily cron, e.g.
//   0 4 * * * cd /srv/fahimni && docker compose -f deploy/docker-compose.production.yml \
//     run --rm fahimni-web node --import tsx scripts/prune-data.ts
// Learning progress and financial ledgers are never touched here (see policy
// in lib/privacy/retention.ts and scripts/delete-student-data.ts).
const { pruneOldData } = await import('../lib/privacy/retention');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const report = await pruneOldData();
console.log('pruned', JSON.stringify(report));
process.exit(0);
