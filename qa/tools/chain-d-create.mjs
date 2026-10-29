import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// CHAIN D (part 1): admin creates an audit subject and uploads a tiny valid PDF.
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const GRADE_ID = 'ac160166-5f14-4234-80b8-a23c647294e7';

function tinyPdf() {
  const offsets = [];
  let body = '%PDF-1.4\n';
  const add = (s) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += s;
  };
  add('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
  add('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n');
  add('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n');
  const stream = 'BT /F1 14 Tf 20 100 Td (Fahimni audit page one) Tj ET';
  add(`4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`);
  add('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n');
  const xrefStart = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const slug = `audit-subject-${Date.now()}`;
mkdirSync('qa/evidence', { recursive: true });
writeFileSync('qa/evidence/audit-subject.pdf', tinyPdf());

const form = new FormData();
form.set('name', 'مادة تدقيق');
form.set('slug', slug);
form.set('gradeId', GRADE_ID);
form.set('academicFieldId', '');
form.set('shortDescription', 'مادة أنشأها التدقيق الآلي');
form.set('isActive', 'on');
form.set('sortOrder', '99');
form.set('monthlyPrice', '9');
form.set('semesterPrice', '19');
form.set('currency', 'JOD');
const create = await fetch(`${BASE}/api/admin/subjects`, {
  method: 'POST',
  headers: { origin: BASE, cookie: `fahimni_session=${sessions.admin}` },
  body: form,
  redirect: 'manual',
});
console.log('create subject:', create.status, create.headers.get('location') ?? '');

const dup = new FormData();
dup.set('name', 'مادة تدقيق مكررة');
dup.set('slug', slug);
dup.set('gradeId', GRADE_ID);
dup.set('academicFieldId', '');
dup.set('isActive', 'on');
dup.set('sortOrder', '98');
dup.set('monthlyPrice', '9');
dup.set('semesterPrice', '19');
dup.set('currency', 'JOD');
const duplicate = await fetch(`${BASE}/api/admin/subjects`, {
  method: 'POST',
  headers: { origin: BASE, cookie: `fahimni_session=${sessions.admin}` },
  body: dup,
  redirect: 'manual',
});
console.log('duplicate slug:', duplicate.status, duplicate.headers.get('location') ?? '');
console.log('slug:', slug);
