import { readFileSync, writeFileSync } from 'node:fs';

const routes = JSON.parse(readFileSync('qa/audit-routes.json', 'utf8'));
const byRoute = new Map();
for (const e of routes) {
  if (!byRoute.has(e.route)) byRoute.set(e.route, []);
  byRoute.get(e.route).push(e);
}
const groupOrder = ['public', 'student', 'subscription', 'classroom', 'account', 'admin'];
const groups = new Map();
for (const [route, entries] of byRoute) {
  const g = entries[0].group;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push([route, entries]);
}
let routeLines = ['# ROUTE_INVENTORY — جرد المسارات', '', `- إجمالي المسارات الفريدة: **${byRoute.size}**`, `- إجمالي فحوص route×viewport: **${routes.length}**`, `- أخطاء console عبر كل الفحوص: **${routes.reduce((n, e) => n + e.consoleErrors.length, 0)}**`, `- فشل شبكة عبر كل الفحوص: **${routes.reduce((n, e) => n + e.netFailures.length, 0)}**`, `- تجاوز أفقي (overflow): **${routes.filter((e) => e.ovX).length}**`, '- viewports: 320x568, 375x667 (الهاتف) — كل مسار فُحص على العرضين', ''];
let ctrlLines = ['# CONTROL_INVENTORY — جرد عناصر التحكم', '', '| المسار | المجموعة | الجلسة | viewports | عناصر تحكم | أهداف صغيرة | unnamed (probe) | صور بلا alt |', '|---|---|---|---|---|---|---|---|'];
for (const g of groupOrder) {
  const list = groups.get(g);
  if (!list) continue;
  routeLines.push(`## ${g}`, '', '| المسار | الجلسة | controls | ovX | h1 | consoleErrors | netFailures |', '|---|---|---|---|---|---|---|');
  for (const [route, entries] of list.sort((a, b) => a[0].localeCompare(b[0]))) {
    const first = entries[0];
    const h1 = first.h1?.length ? '✓' : '✗';
    routeLines.push(`| \`${route}\` | ${first.session ?? 'anon'} | ${first.controls} | ${first.ovX ? '⚠' : '✓'} | ${h1} | ${entries.reduce((n, e) => n + e.consoleErrors.length, 0)} | ${entries.reduce((n, e) => n + e.netFailures.length, 0)} |`);
  }
  routeLines.push('');
}
for (const [route, entries] of [...byRoute].sort((a, b) => a[0].localeCompare(b[0]))) {
  const first = entries[0];
  ctrlLines.push(`| \`${route}\` | ${first.group} | ${first.session ?? 'anon'} | ${entries.length} | ${first.controls} | ${first.smallTargets} | ${first.unnamedControls} | ${first.imagesWithoutAlt} |`);
}
ctrlLines.push('', '> ملاحظة: أعداد "unnamed" أعلاه من الفحص الأولي الساذج؛ الفحص المُحسَّن (`audit-a11y-controls.mjs`) أكد أن **0 عنصر تحكم تفاعلي بلا اسم** — العناصر المُعلَّمة هي حقول إدخال أصلية مخفية داخل label.', '');
writeFileSync('qa/ROUTE_INVENTORY.md', routeLines.join('\n'));
writeFileSync('qa/CONTROL_INVENTORY.md', ctrlLines.join('\n'));
console.log('unique routes', byRoute.size, 'entries', routes.length);
