import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// Bounded production-build load test. NO AI calls: only pages and the health
// endpoint, plus one real private book page for an entitled student.
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3100';
const BOOK_ID = '11111111-1111-4111-8111-111111111111';

const targets = [
  { name: 'landing', path: '/', auth: false },
  { name: 'login', path: '/login', auth: false },
  { name: 'health', path: '/api/health', auth: false },
  { name: 'app-dashboard', path: '/app', auth: true },
  { name: 'classroom-shell', path: '/app/subjects/tawjihi-math/tutor', auth: true },
  { name: 'book-page', path: `/api/books/${BOOK_ID}/pages/50`, auth: true },
  { name: 'subscription', path: '/app/subscription', auth: true },
];

function serverStats() {
  try {
    const out = execSync(`ps -axo rss,%cpu,command | grep next-server | grep -v grep`).toString().trim().split('\n')[0] ?? '';
    const match = out.match(/^\s*(\d+)\s+([\d.]+)/);
    if (!match) return null;
    return { rssMb: Math.round(Number(match[1]) / 1024), cpuPercent: Number(match[2]) };
  } catch {
    return null;
  }
}

async function runScenario(concurrency, durationMs) {
  const latencies = new Map();
  const statuses = new Map();
  let done = 0;
  let errors = 0;
  const deadline = Date.now() + durationMs;

  async function worker(workerId) {
    let index = workerId;
    while (Date.now() < deadline) {
      const target = targets[index % targets.length];
      index += 1;
      const headers = {};
      if (target.auth && sessions.student) headers.cookie = `fahimni_session=${sessions.student}`;
      const started = performance.now();
      try {
        const response = await fetch(`${BASE}${target.path}`, { headers, redirect: 'manual' });
        const ms = performance.now() - started;
        const bucket = latencies.get(target.name) ?? [];
        bucket.push(ms);
        latencies.set(target.name, bucket);
        statuses.set(`${target.name}:${response.status}`, (statuses.get(`${target.name}:${response.status}`) ?? 0) + 1);
        // Drain the body so connections are reused honestly.
        await response.arrayBuffer();
        if (response.status >= 400) errors += 1;
      } catch {
        errors += 1;
        statuses.set(`${target.name}:network_error`, (statuses.get(`${target.name}:network_error`) ?? 0) + 1);
      }
      done += 1;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, id) => worker(id)));
  const all = [...latencies.values()].flat().sort((a, b) => a - b);
  const percentile = (p) => (all.length ? Math.round(all[Math.min(all.length - 1, Math.floor((p / 100) * all.length))] * 10) / 10 : null);
  const perRoute = {};
  for (const [name, values] of latencies) {
    const sorted = [...values].sort((a, b) => a - b);
    perRoute[name] = {
      count: values.length,
      p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] * 10) / 10,
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
    };
  }
  return {
    concurrency,
    durationMs,
    requests: done,
    errors,
    errorRate: done ? Math.round((errors / done) * 10000) / 100 : null,
    rps: Math.round((done / (durationMs / 1000)) * 10) / 10,
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    perRoute,
    statuses: Object.fromEntries([...statuses.entries()].sort()),
  };
}

const out = { startedAt: new Date().toISOString(), baseline: serverStats(), scenarios: [] };
for (const scenario of [
  { concurrency: 10, durationMs: 10000 },
  { concurrency: 25, durationMs: 10000 },
]) {
  const result = await runScenario(scenario.concurrency, scenario.durationMs);
  result.serverAfter = serverStats();
  out.scenarios.push(result);
  console.log(`c=${scenario.concurrency} requests=${result.requests} rps=${result.rps} p50=${result.p50}ms p95=${result.p95}ms p99=${result.p99}ms errors=${result.errors} rss=${result.serverAfter?.rssMb}MB cpu=${result.serverAfter?.cpuPercent}%`);
}
out.finishedAt = new Date().toISOString();
writeFileSync('qa/audit-phase7-load.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.scenarios.map((s) => ({ c: s.concurrency, statuses: s.statuses })), null, 1));
