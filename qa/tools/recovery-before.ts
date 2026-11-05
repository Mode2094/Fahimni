import {chromium} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {unitCircleFixture} from '../../lib/whiteboard/recovery-fixtures';

// Serve the unmodified PR3 SHA in a separate worktree on port3011. Feed both
// renderers the same labelled fixture through the real question composer.
const dir='docs/reviews/recovery/before';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
await page.route('**/api/speech',r=>r.fulfill({status:503,json:{error:'اختبار عرض دون اتصال صوتي.'}}));
await page.route('**/api/tutor',r=>r.fulfill({json:unitCircleFixture}));
for(const [name,path] of [['landing','/'],['dashboard','/api/auth/dev-login?target=student'],['subjects','/app/subjects'],['classroom-idle','/app/subjects/tawjihi-math/tutor']]){
 await page.goto(`http://localhost:3011${path}`);await page.waitForTimeout(600);
 await page.screenshot({path:`${dir}/${name}-1440.png`,fullPage:true});
}
await page.getByRole('textbox',{name:'سؤالك للمعلم'}).fill('اختبار عرض: دائرة الوحدة');
await page.getByRole('button',{name:'أرسل السؤال'}).click();
await page.locator('.mobile-units button').last().waitFor();
await page.locator('.mobile-units button').last().click();
await page.waitForTimeout(10000);
await page.screenshot({path:`${dir}/unit-circle-1440.png`,fullPage:true});
writeFileSync(`${dir}/metadata.json`,JSON.stringify({capturedAt:new Date().toISOString(),baseline:'3169f5e96c4a22c83fc497bb9815891e556cc392',port:3011,fixture:'unitCircleFixture supplied via intercepted tutor response; all provider calls blocked',circleElements:await page.locator('.graph-layer circle[data-world-radius]').count()},null,2));
await browser.close();
