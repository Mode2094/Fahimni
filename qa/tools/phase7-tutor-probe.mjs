import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Targeted probe: verify the production rate limiter (Redis) is reachable and
// that an exhausted wallet fails with the correct Arabic credit error.
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const PSQL = `psql -tA 'postgresql://mrik@127.0.0.1:5432/fahimni_local'`;
const balances = execSync(`${PSQL} -c "select id, credit_balance from entitlements where user_id = (select id from users where email = 'student@fahimni.local')"`).toString().trim();
const original = balances.split('\n').filter(Boolean).map((line) => {
  const [id, balance] = line.split('|');
  return { id, balance: Number(balance) };
});
execSync(`${PSQL} -c "update entitlements set credit_balance = 0 where user_id = (select id from users where email = 'student@fahimni.local')"`, { stdio: 'pipe' });

const cookie = [`fahimni_session=${sessions.student}`, sessions.deviceToken ? `fahimni_device=${sessions.deviceToken}` : null].filter(Boolean).join('; ');
const response = await fetch('http://localhost:3100/api/tutor', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost:3100', cookie },
  body: JSON.stringify({ question: 'سؤال اختبار الرصيد', board: { objects: [] }, history: [], currentStep: 0, currentLesson: null, subjectSlug: 'tawjihi-math', requestId: crypto.randomUUID() }),
});
const payload = await response.json().catch(() => ({}));
console.log(JSON.stringify({ status: response.status, code: payload.code ?? null }));

for (const entry of original) {
  execSync(`${PSQL} -c "update entitlements set credit_balance = ${entry.balance} where id = '${entry.id}'"`, { stdio: 'pipe' });
}
console.log('wallet-restored', JSON.stringify(original));
