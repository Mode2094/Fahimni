import { readFileSync } from 'node:fs';

// Honest probe of the admin catalog page content on the production build.
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const response = await fetch('http://localhost:3100/admin/subjects', {
  headers: { cookie: `fahimni_session=${sessions.admin}` },
});
const html = await response.text();
const checks = {
  status: response.status,
  hasTitle: html.includes('المواد'),
  hasMathSubject: html.includes('رياضيات'),
  hasPhysics: html.includes('فيزياء'),
  hasAddButton: html.includes('إضافة') || html.includes('مادة جديدة'),
  noErrorAlert: !html.includes('fn-alert--error'),
  rows: (html.match(/<tr/g) ?? []).length,
  emptyState: html.includes('لا توجد') || html.includes('فارغة'),
  length: html.length,
};
console.log(JSON.stringify(checks));
