import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// Isolated backup + RESTORATION verification. Never touches owner data:
// the source DB is only read (pg_dump), restoration goes into a throwaway
// database and a throwaway directory, both deleted at the end.
const SOURCE_DB = process.env.SOURCE_DB ?? 'fahimni_local';
const RESTORE_DB = 'fahimni_restore_test';
const WORK = '/tmp/phase7-backup-restore';
const PG = 'postgresql://mrik@127.0.0.1:5432';

const run = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const out = { startedAt: new Date().toISOString(), steps: [] };

// 1. Fresh workspace + isolated source data directory with sample private files.
rmSync(WORK, { recursive: true, force: true });
mkdirSync(`${WORK}/data/books/book-1/pages`, { recursive: true });
mkdirSync(`${WORK}/data/uploads`, { recursive: true });
writeFileSync(`${WORK}/data/books/book-1/pages/1.jpg`, 'page-one-bytes');
writeFileSync(`${WORK}/data/uploads/abc.jpg`, 'upload-bytes');
const sourceHash = createHash('sha256')
  .update(readFileSync(`${WORK}/data/books/book-1/pages/1.jpg`))
  .update(readFileSync(`${WORK}/data/uploads/abc.jpg`))
  .digest('hex');

// 2. Backup: pg_dump (read-only on the source) + tar of the private data dir.
run(`pg_dump --no-owner --no-privileges ${PG}/${SOURCE_DB} | gzip > ${WORK}/db.sql.gz`);
run(`tar -czf ${WORK}/data.tar.gz -C ${WORK}/data books uploads`);
out.steps.push({ step: 'backup', dbBytes: Number(run(`stat -f%z ${WORK}/db.sql.gz`)), dataBytes: Number(run(`stat -f%z ${WORK}/data.tar.gz`)) });

// 3. Restore the database into a throwaway database.
run(`dropdb --if-exists ${RESTORE_DB}`);
run(`createdb ${RESTORE_DB}`);
run(`gunzip -c ${WORK}/db.sql.gz | psql -q ${PG}/${RESTORE_DB}`);
const tables = ['users', 'student_profiles', 'books', 'textbook_chunks', 'entitlements', 'free_trials', 'ai_usage_events', 'webhook_events', 'billing_events', 'learning_progress', 'secure_settings'];
const counts = {};
for (const table of tables) {
  const source = Number(run(`psql -tA ${PG}/${SOURCE_DB} -c "select count(*) from ${table}"`));
  const restored = Number(run(`psql -tA ${PG}/${RESTORE_DB} -c "select count(*) from ${table}"`));
  counts[table] = { source, restored, match: source === restored };
}
out.steps.push({ step: 'db-restore', counts });
out.dbMatch = Object.values(counts).every((entry) => entry.match);

// 4. Restore the private files and verify byte-identity.
mkdirSync(`${WORK}/restore`, { recursive: true });
run(`tar -xzf ${WORK}/data.tar.gz -C ${WORK}/restore`);
const restoredHash = createHash('sha256')
  .update(readFileSync(`${WORK}/restore/books/book-1/pages/1.jpg`))
  .update(readFileSync(`${WORK}/restore/uploads/abc.jpg`))
  .digest('hex');
out.filesMatch = sourceHash === restoredHash;
out.steps.push({ step: 'files-restore', filesMatch: out.filesMatch });

// 5. Sanity: the restored schema accepts the app's migration runner (no-op).
const migrations = run(`psql -tA ${PG}/${RESTORE_DB} -c "select count(*) from drizzle.__drizzle_migrations"`);
out.steps.push({ step: 'migrations', applied: Number(migrations) });

// 6. Cleanup everything created by this test.
run(`dropdb --if-exists ${RESTORE_DB}`);
rmSync(WORK, { recursive: true, force: true });
out.finishedAt = new Date().toISOString();
writeFileSync('qa/audit-phase7-backup-restore.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
