import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

import {checkHealth} from '../lib/health';
import {buildSecurityHeaders} from '../lib/security/headers';

test('security headers are production-safe and keep integrations working', () => {
 const prod = buildSecurityHeaders({production: true, https: true});
 assert.equal(prod['X-Content-Type-Options'], 'nosniff');
 assert.equal(prod['X-Frame-Options'], 'DENY');
 assert.match(prod['Referrer-Policy'], /strict-origin/);
 assert.match(prod['Permissions-Policy'], /camera=\(self\)/);
 assert.match(prod['Strict-Transport-Security'], /max-age=/);
 assert.match(prod['Content-Security-Policy'], /checkout\.freemius\.com/);
 assert.match(prod['Content-Security-Policy'], /accounts\.google\.com/);
 assert.doesNotMatch(prod['Content-Security-Policy'], /'unsafe-eval'/);

 const dev = buildSecurityHeaders({production: false, https: false});
 assert.equal(dev['Strict-Transport-Security'], undefined);
 assert.match(dev['Content-Security-Policy'], /'unsafe-eval'/);

 const prodHttp = buildSecurityHeaders({production: true, https: false});
 assert.equal(prodHttp['Strict-Transport-Security'], undefined);
});

test('health report is safe and reflects dependency state', async () => {
 const ok = await checkHealth({checkDatabase: async () => undefined, checkRedis: async () => 'ok'});
 assert.deepEqual(ok, {status: 'ok', checks: {app: 'ok', database: 'ok', redis: 'ok'}});

 const noRedis = await checkHealth({checkDatabase: async () => undefined, checkRedis: async () => 'not_configured'});
 assert.equal(noRedis.status, 'ok');

 const dbDown = await checkHealth({
  checkDatabase: async () => { throw new Error('boom'); },
  checkRedis: async () => 'ok',
 });
 assert.equal(dbDown.status, 'degraded');
 assert.equal(dbDown.checks.database, 'down');
 assert.equal(JSON.stringify(dbDown).includes('boom'), false);

 const redisDown = await checkHealth({checkDatabase: async () => undefined, checkRedis: async () => 'down'});
 assert.equal(redisDown.status, 'degraded');
});

test('PWA manifest is valid Arabic RTL metadata', async () => {
 const manifest = JSON.parse(await readFile(path.join(process.cwd(), 'public/manifest.webmanifest'), 'utf8')) as {
  name: string; short_name: string; lang: string; dir: string; display: string;
  icons: { sizes: string; purpose?: string }[];
 };
 assert.equal(manifest.name, 'فهمني');
 assert.equal(manifest.short_name, 'فهمني');
 assert.equal(manifest.lang, 'ar');
 assert.equal(manifest.dir, 'rtl');
 assert.equal(manifest.display, 'standalone');
 assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
 assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('service worker only caches safe static assets', async () => {
 const sw = await readFile(path.join(process.cwd(), 'public/sw.js'), 'utf8');
 assert.match(sw, /'\/_next\/static\/'/);
 assert.match(sw, /'\/icons\/'/);
 assert.match(sw, /'\/fonts\/'/);
 assert.doesNotMatch(sw, /'\/api\//);
 assert.match(sw, /request\.method !== 'GET'/);
});
