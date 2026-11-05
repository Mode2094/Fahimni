import {chromium,expect,type FullConfig} from '@playwright/test';

// Bootstrap one isolated fixture account serially, so parallel browser tests
// cannot race to claim the same trial. Real providers are always blocked.
export default async function setup(config:FullConfig){
 const baseURL=String(config.projects[0].use.baseURL);
 if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseURL))throw new Error('Recovery browser suite is localhost-only');
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  for(const endpoint of ['tutor','speech','vision','transcribe'])await page.route(`**/api/${endpoint}`,r=>r.fulfill({status:503,json:{error:'اختبار محلي فقط'}}));
  await page.goto(`${baseURL}/api/auth/dev-login?target=student`);
  // The disposable account may already have a development semester grant.
  // Confirm the dashboard loaded; claim a trial only when it is offered.
  await expect(page.getByRole('heading',{level:1,name:/مرحبًا/})).toBeVisible();
  const claim=page.getByRole('button',{name:'ابدأ تجربتك المجانية',exact:true});
  if(await claim.count()){await claim.click();await expect(page.locator('.trial-card')).toContainText(/تجربتك جاهزة|تجربتك المجانية نشطة/);}
 }finally{await browser.close();}
}
