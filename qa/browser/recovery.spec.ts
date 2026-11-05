import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {readFileSync} from 'node:fs';
import { unitCircleFixture, algebraFixture } from '../../lib/whiteboard/recovery-fixtures';
import type { Lesson } from '../../schemas/lesson';

const screenshots = 'docs/reviews/recovery/after';
mkdirSync(screenshots, { recursive: true });
const widths = [360, 390, 430, 768, 1024, 1040, 1280, 1440, 1920];
const question = 'اشرح دائرة الوحدة عند النقطة (-0.6, 0.8)';
const cleanText = async (page: Page) => {
  const content = await page.locator('body').innerText();
  expect(content).not.toMatch(/â€|Î¸|\uFFFD|audio timeout|^audio$/m);
  expect(await page.locator('.math-error').count()).toBe(0);
};

async function screenshot(page: Page, name: string) {
  // Wait for streamed route content, not only the navigation shell/skeleton.
  if(!await page.locator('.classroom').count())await expect(page.locator('h1').first()).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({ path: `${screenshots}/${name}.png`, fullPage: true, caret: 'initial' });
}

async function prepare(page: Page, lesson: Lesson = unitCircleFixture) {
  const requests: { tutor: number; speech: number; vision: number; transcribe: number } = { tutor: 0, speech: 0, vision: 0, transcribe: 0 };
  const submitted: string[] = [];
  await page.route('**/api/tutor', async route => {
    requests.tutor++;
    submitted.push(route.request().postDataJSON().question);
    const isAlgebra=lesson.id==='algebra';
    const answer = requests.tutor > 1 ? {
      ...lesson, id: 'fixture-followup', title: 'عرض تجريبي — توضيح الخطوة', mode: 'followup',
      segments: [{ id: 'fixture-f1', goal: isAlgebra?'لماذا قسمنا على ثلاثة؟':'نربط الربع الثاني بالإشارة', narration: isAlgebra?'ثلاثة إكس تعني ثلاث مجموعات متساوية مجموعها اثنا عشر. نقسم الطرفين على ثلاثة فنعرف أن قيمة كل مجموعة أربعة.':'الإحداثي السيني سالب لأن النقطة تقع يسار المحور الصادي. نقرأ المسافة الأفقية من نقطة الأصل.', sourceChunkIds: ['rendering-fixture'], sources: [], actions: [{ type: 'write_text', id: 'followup-note', content: isAlgebra?'القسمة على ثلاثة تعكس الضرب في ثلاثة وتحافظ على التساوي.':'يسار المحور الصادي: الإحداثي السيني سالب.', region: 'explanation-area', targets: [], points: [], color: 'blue', geometry: null, delayMs: 0 }] }],
    } : lesson;
    await route.fulfill({ status: 200, json: answer });
  });
  await page.route('**/api/speech', route => {
    requests.speech++;
    return route.fulfill({ status: 503, json: { error: 'audio' } });
  });
  await page.route('**/api/vision', route => {
    requests.vision++;
    return route.fulfill({ status: 200, json: { question: 'حل المعادلة 3x+6=18' } });
  });
  await page.route('**/api/transcribe', route => {
    requests.transcribe++;
    return route.fulfill({ status: 200, json: { question: 'اشرح لماذا الجيب موجب في الربع الثاني' } });
  });
  await page.goto('/api/auth/dev-login?target=student');
  await expect(page.getByRole('heading',{level:1,name:/مرحبًا/})).toBeVisible();
  const claim=page.getByRole('button',{name:'ابدأ تجربتك المجانية',exact:true});
  if(await claim.count()){
    await claim.click();
    await expect(page.locator('.trial-card')).toContainText(/تجربتك جاهزة|تجربتك المجانية نشطة/);
  }
  await page.goto('/app/subjects/tawjihi-math/tutor');
  await expect(page.locator('.classroom')).toBeVisible();
  await page.getByRole('button', { name: 'كتم صوت المعلم', exact: true }).click();
  return { requests, submitted };
}

async function start(page: Page, value = question) {
  await page.getByRole('textbox', { name: 'سؤالك للمعلم' }).fill(value);
  await page.getByRole('button', { name: 'أرسل السؤال', exact: true }).click();
  await expect(page.locator('[data-object-id="heading"], [data-object-id="equation"]')).toBeVisible();
}

async function lastStep(page: Page, name: string) {
  await page.getByRole('button', { name: 'رحلة الحل', exact: true }).click();
  await page.locator('.steps button').filter({ hasText: name }).click();
}

for (const width of widths) {
  test(`unit circle remains accurate and usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 900 : 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message=>{if(message.type()==='error')errors.push(message.text());});
    await prepare(page);
    if (width === 1440) await screenshot(page, 'classroom-idle-1440');
    await start(page);
    await expect(page.locator('[data-object-id="circle"] circle')).toBeVisible();
    if (width === 1440) await screenshot(page, 'unit-circle-step-1-1440');
    await lastStep(page, 'الظل ونراجع الإشارات');
    await expect(page.locator('[data-object-id="tan"]')).toBeVisible();
    await expect(page.locator('[data-object-id="signs"]')).toBeVisible();
    await page.getByRole('button', { name: 'إيقاف مؤقت', exact: true }).click();
    const geometry = await page.locator('.graph-layer svg').evaluate(svg => {
      const circle = svg.querySelector<SVGCircleElement>('[data-object-id="circle"] circle')!;
      const point = svg.querySelector<SVGCircleElement>('[data-object-id="point-p"] circle')!;
      const circleBounds = circle.getBoundingClientRect();
      const viewport = svg.getBoundingClientRect();
      return {
        cx: circle.cx.baseVal.value, cy: circle.cy.baseVal.value, radius: circle.r.baseVal.value,
        px: point.cx.baseVal.value, py: point.cy.baseVal.value,
        width: circleBounds.width, height: circleBounds.height, sceneWidth: viewport.width,
      };
    });
    expect(Math.abs(geometry.width - geometry.height)).toBeLessThan(1);
    expect(geometry.width / geometry.sceneWidth).toBeGreaterThan(.55);
    expect((geometry.px - geometry.cx) / geometry.radius).toBeCloseTo(-.6, 5);
    expect((geometry.cy - geometry.py) / geometry.radius).toBeCloseTo(.8, 5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    expect(overflow).toBe(false);
    await expect(page.locator('.teacher-actions > button')).toHaveCount(3);
    if(width>=768){
      const viewport=await page.locator('.board-scroll').boundingBox();
      const conclusion=await page.locator('[data-object-id="signs"]').boundingBox();
      expect(conclusion!.y+conclusion!.height).toBeLessThanOrEqual(viewport!.y+viewport!.height-8);
    }
    await expect(page.getByRole('textbox', { name: 'سؤالك للمعلم' })).toBeVisible();
    await cleanText(page);
    expect(errors).toEqual([]);
    await screenshot(page, `unit-circle-${width}`);
  });
}

test('algebra solution, transcript, follow-up and exact lesson return', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { requests } = await prepare(page, algebraFixture);
  await start(page, 'حل 3x+6=18 وتحقق من الحل');
  await lastStep(page, 'نعوض للتحقق');
  await expect(page.locator('[data-object-id="check"]')).toBeVisible();
  await screenshot(page, 'algebra-completed-1440');
  await page.getByRole('button', { name: 'إيقاف مؤقت', exact: true }).click();
  await page.getByRole('button', { name: 'نص الشرح', exact: true }).click();
  await expect(page.getByRole('region', { name: 'نص الشرح الكامل' })).toBeVisible();
  await screenshot(page, 'transcript-1440');
  await page.getByRole('button', { name: 'إغلاق نص الشرح', exact: true }).click();
  await page.getByRole('button', { name: 'اشرحها أبسط', exact: true }).first().click();
  await expect(page.locator('[data-object-id="followup-note"]')).toBeVisible();
  expect(requests.tutor).toBe(2);
  await screenshot(page, 'simplification-followup-1440');
  await page.getByRole('button', { name: 'العودة إلى الدرس · كمل الشرح', exact: true }).click();
  await expect(page.locator('.step-time')).toHaveText('الخطوة 4 من 4');
  await expect(page.locator('[data-object-id="check"]')).toBeVisible();
  await expect(page.locator('[data-object-id="followup-note"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'رحلة الحل', exact: true }).click();
  await screenshot(page, 'lesson-journey-1440');
  await cleanText(page);
});

test('image recognition stays editable and waits for manual send', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const { requests, submitted } = await prepare(page, algebraFixture);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'question.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
  });
  const composer = page.getByRole('textbox', { name: 'سؤالك للمعلم' });
  await expect(composer).toHaveValue('حل المعادلة 3x+6=18');
  expect(requests.tutor).toBe(0);
  await composer.fill('حل المعادلة 3x+6=18 وتحقق من النتيجة');
  await screenshot(page, 'image-review-mobile-390');
  await page.getByRole('button', { name: 'أرسل السؤال', exact: true }).click();
  await expect.poll(() => requests.tutor).toBe(1);
  expect(submitted[0]).toBe('حل المعادلة 3x+6=18 وتحقق من النتيجة');
});

test('synthetic microphone stream is recorded, reviewed, edited and manually sent', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  // Real MediaRecorder on a WebAudio stream. This isolates the recording/review
  // workflow from macOS headless microphone devices, whose getUserMedia promise
  // does not resolve in this environment. Transcription remains an explicit stub.
  await page.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const audio=new AudioContext();
      const oscillator=audio.createOscillator();
      const destination=audio.createMediaStreamDestination();
      oscillator.connect(destination);oscillator.start();
      destination.stream.getTracks().forEach(track=>track.addEventListener('ended',()=>{oscillator.stop();void audio.close();},{once:true}));
      return destination.stream;
    };
  });
  const { requests } = await prepare(page);
  await page.getByRole('button', { name: 'تسجيل سؤال صوتي', exact: true }).click();
  await expect(page.getByRole('button', { name: 'إنهاء التسجيل', exact: true })).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'إنهاء التسجيل', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'سؤالك للمعلم' });
  await expect(composer).toHaveValue('اشرح لماذا الجيب موجب في الربع الثاني');
  expect(requests.transcribe).toBe(1);
  expect(requests.tutor).toBe(0);
  await composer.fill('اشرح لماذا الجيب موجب في الربع الثاني مع رسم');
  await screenshot(page, 'voice-question-review-1440');
  await page.getByRole('button', { name: 'أرسل السؤال', exact: true }).click();
  await expect.poll(() => requests.tutor).toBe(1);
});

test('broken speech response shows Arabic fallback without raw internal audio text', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'تفعيل صوت المعلم', exact: true }).click();
  await start(page);
  await expect(page.getByText('تعذر تشغيل الصوت. يمكنك متابعة الشرح المكتوب وإعادة الخطوة لاحقاً.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-object-id="circle"] circle')).toBeVisible();
  await cleanText(page);
  await screenshot(page, 'audio-error-fallback-1280');
});

test('stored Arabic audio fixture decodes, pauses and resumes without a paid speech call',async({page})=>{
 const {requests}=await prepare(page,algebraFixture);
 await page.route('**/api/speech',route=>{
  requests.speech++;
  return route.fulfill({status:200,contentType:'audio/mpeg',body:readFileSync('qa/evidence/audio/teaching-narration.mp3')});
 });
 await page.getByRole('button',{name:'تفعيل صوت المعلم',exact:true}).click();
 await start(page,'حل 3x+6=18');
 await expect(page.locator('.teacher-state')).toHaveText('المعلّم يتحدث');
 await page.getByRole('button',{name:'إيقاف مؤقت',exact:true}).click();
 await expect(page.locator('.teacher-state')).not.toHaveText('المعلّم يتحدث');
 await page.getByRole('button',{name:'تشغيل',exact:true}).click();
 await expect(page.locator('.teacher-state')).toHaveText('المعلّم يتحدث');
 const before=requests.speech;
 await page.getByRole('button',{name:'أدوات الشرح',exact:true}).click();
 await page.getByRole('button',{name:'أعد الخطوة',exact:true}).click();
 await expect(page.locator('.teacher-state')).toHaveText('المعلّم يتحدث');
 expect(requests.speech).toBe(before);
 await screenshot(page,'stored-arabic-audio-fixture-1280');
});

test('enabling sound in a paused text-only step starts that same step audio',async({page})=>{
 await prepare(page,algebraFixture);
 await page.route('**/api/speech',route=>route.fulfill({status:200,contentType:'audio/mpeg',body:readFileSync('qa/evidence/audio/teaching-narration.mp3')}));
 await start(page,'حل 3x+6=18');
 await page.getByRole('button',{name:'إيقاف مؤقت',exact:true}).click();
 await page.getByRole('button',{name:'تفعيل صوت المعلم',exact:true}).click();
 await page.getByRole('button',{name:'تشغيل',exact:true}).click();
 await expect(page.locator('.teacher-state')).toHaveText('المعلّم يتحدث',{timeout:3000});
 await expect(page.locator('.step-time')).toHaveText('الخطوة 1 من 4');
});

test('corrupt audio file decode falls back safely to written teaching',async({page})=>{
 await prepare(page);
 await page.route('**/api/speech',route=>route.fulfill({status:200,contentType:'audio/mpeg',body:Buffer.from('invalid audio fixture')}));
 await page.getByRole('button',{name:'تفعيل صوت المعلم',exact:true}).click();
 await start(page);
 await expect(page.getByText('تعذر تشغيل الصوت. يمكنك متابعة الشرح المكتوب وإعادة الخطوة لاحقاً.',{exact:true})).toBeVisible();
 await cleanText(page);
 await screenshot(page,'audio-decode-error-fallback-1280');
});

test('a question about a board object carries its identity and preserves lesson return',async({page})=>{
 const {submitted}=await prepare(page);
 await start(page);
 await lastStep(page,'الظل ونراجع الإشارات');
 await expect(page.locator('[data-object-id="sin"]')).toBeVisible();
 await page.locator('[data-object-id="sin"]').click();
 await page.getByRole('textbox',{name:'سؤالك للمعلم'}).fill('ليش الجيب موجب هنا؟');
 await page.getByRole('button',{name:'أرسل السؤال',exact:true}).click();
 await expect(page.locator('[data-object-id="followup-note"]')).toBeVisible();
 expect(submitted[1]).toContain('sin');
 await expect(page.getByRole('button',{name:'العودة إلى الدرس · كمل الشرح',exact:true})).toBeVisible();
 await screenshot(page,'object-question-followup-1280');
 await page.getByRole('button',{name:'العودة إلى الدرس · كمل الشرح',exact:true}).click();
 await expect(page.locator('.step-time')).toHaveText('الخطوة 5 من 5');
 await expect(page.locator('[data-object-id="followup-note"]')).toHaveCount(0);
});

test('tools dialog supports Escape and restores keyboard focus to its trigger',async({page})=>{
 await prepare(page);
 const trigger=page.getByRole('button',{name:'أدوات الشرح',exact:true});
 await trigger.click();
 await expect(page.getByRole('dialog',{name:'أدوات الشرح',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog',{name:'أدوات الشرح',exact:true})).toHaveCount(0);
 await expect(trigger).toBeFocused();
});

test('public, student and admin routes render at desktop and mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
    page.on('console', message=>{if(message.type()==='error')errors.push(message.text());});
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await screenshot(page, `landing-${width}`);
    await page.goto('/api/auth/dev-login?target=student');
    for (const [name, url] of [['dashboard','/app'],['subjects','/app/subjects'],['subscription','/app/subscription'],['review','/app/review'],['account','/app/account']] as const) {
      await page.goto(url);
      await expect(page.locator('body')).not.toContainText('Internal Server Error');
      await screenshot(page, `${name}-${width}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    }
    await page.goto('/api/auth/dev-login?target=admin');
    await screenshot(page, `admin-${width}`);
  }
  expect(errors).toEqual([]);
});

test('generic visual engine renders geometry, vectors and Arabic text fixtures', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1000 });
  await prepare(page);
  for(const [key,object] of [['geometry','geo-area'],['physics','vec-result-value'],['arabic','ar-role-3']] as const){
    await page.goto(`/app/subjects/tawjihi-math/tutor?fixture=${key}`);
    await expect(page.getByText('اختبار عرض محلي',{exact:true})).toBeVisible();
    await expect(page.locator(`[data-object-id="${object}"]`)).toBeVisible();
    await cleanText(page);
    await screenshot(page,`${key}-fixture-1024`);
  }
});

for(const zoom of [1.25,2]){
  test(`classroom reflows at CSS zoom ${zoom*100}%`,async({page})=>{
    await page.setViewportSize({width:1440,height:1000});
    await prepare(page,algebraFixture);
    await page.evaluate(value=>{document.documentElement.style.zoom=String(value);},zoom);
    await start(page,'حل المعادلة 3x+6=18');
    await expect(page.locator('[data-object-id="equation"]')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    await expect(page.getByRole('textbox',{name:'سؤالك للمعلم'})).toBeVisible();
    await screenshot(page,`classroom-css-zoom-${zoom*100}`);
  });
}
