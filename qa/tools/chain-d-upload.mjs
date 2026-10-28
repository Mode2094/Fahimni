import { readFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const subjectId = process.argv[2];
const file = readFileSync('qa/evidence/audit-subject.pdf');

const form = new FormData();
form.set('file', new File([file], 'audit-book.pdf', { type: 'application/pdf' }));
form.set('title', 'كتاب التدقيق');
const res = await fetch(`${BASE}/api/admin/subjects/${subjectId}/book`, {
  method: 'POST',
  headers: { origin: BASE, cookie: `fahimni_session=${sessions.admin}` },
  body: form,
  redirect: 'manual',
});
console.log('upload:', res.status, res.headers.get('location') ?? '');
