/* global chrome */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';

// Native Chromium zoom; the extension has access only to this disposable local
// test origin. No real profile, provider call, API key or customer data is used.
const extension=resolve('.qa/recovery-zoom-extension');
mkdirSync(extension,{recursive:true});
mkdirSync('docs/reviews/recovery/after',{recursive:true});
writeFileSync(`${extension}/manifest.json`,JSON.stringify({manifest_version:3,name:'Local Fahimni zoom verification',version:'1.0',permissions:['tabs'],host_permissions:['http://localhost:3010/*'],background:{service_worker:'worker.js'}}));
writeFileSync(`${extension}/worker.js`,'chrome.runtime.onInstalled.addListener(() => {});');
const context=await chromium.launchPersistentContext(resolve('.qa/recovery-zoom-profile'),{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try{
 const page=await context.newPage();
 await page.route('**/api/speech',r=>r.fulfill({status:503,json:{error:'اختبار محلي فقط'}}));
 await page.route('**/api/tutor',r=>r.fulfill({status:503,json:{error:'اختبار محلي فقط'}}));
 await page.goto('http://localhost:3010/api/auth/dev-login?target=student');
 await page.goto('http://localhost:3010/app/subjects/tawjihi-math/tutor?fixture=unit-circle');
 await page.getByRole('button',{name:'رحلة الحل',exact:true}).click();
 await page.locator('.steps button').filter({hasText:'الظل ونراجع الإشارات'}).click();
 await page.locator('[data-object-id="signs"]').waitFor({timeout:15000});
 await page.getByRole('button',{name:'إيقاف مؤقت',exact:true}).click();
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:10000});
 const results=[];
 for(const zoom of [1,1.25,2]){
  await worker.evaluate(async value=>{
   const tabs=await chrome.tabs.query({url:'http://localhost:3010/*'});
   for(const tab of tabs)await chrome.tabs.setZoom(tab.id,value);
  },zoom);
  await page.waitForTimeout(500);
  await page.evaluate(()=>scrollTo(0,0));
  const metrics=await page.evaluate(()=>{
   const bounds=document.querySelector('[data-object-id="circle"] circle').getBoundingClientRect();
   return {innerWidth,devicePixelRatio,visualScale:visualViewport?.scale,scrollWidth:document.documentElement.scrollWidth,circleWidth:bounds.width,circleHeight:bounds.height};
  });
  assert.ok(Math.abs(metrics.innerWidth-1440/zoom)<1,'native browser zoom must reflow the CSS viewport');
  assert.equal(metrics.devicePixelRatio,zoom);
  assert.equal(metrics.scrollWidth,metrics.innerWidth,'no horizontal page overflow');
  assert.ok(Math.abs(metrics.circleWidth-metrics.circleHeight)<1,'the circle remains round');
  results.push({zoom,...metrics});
  const client=await context.newCDPSession(page);
  const viewportShot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(`docs/reviews/recovery/after/classroom-native-zoom-${zoom*100}.png`,Buffer.from(viewportShot.data,'base64'));
  const layout=await client.send('Page.getLayoutMetrics');
  // Native zoom requires physical clip dimensions. Playwright fullPage clips
  // the image at the CSS width, cutting off the zoomed right/bottom content.
  const fullShot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:layout.cssContentSize.width*zoom,height:layout.cssContentSize.height*zoom,scale:1}});
  writeFileSync(`docs/reviews/recovery/after/classroom-native-zoom-full-${zoom*100}.png`,Buffer.from(fullShot.data,'base64'));
 }
 writeFileSync('docs/reviews/recovery/native-zoom-extension.json',JSON.stringify({environment:'Chromium headless with isolated localhost-only extension; chrome.tabs.setZoom',results},null,2));
 console.log(JSON.stringify(results));
}finally{await context.close();}
