import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import type {Lesson,BoardState} from '../../schemas/lesson';
import {beforeSegment,runActions} from '../../lib/whiteboard/engine';
import {assertVisualMath} from '../../lib/ai/visual-math-check';

// Opt-in only, after all free checks. The local review server must route every
// provider request through the cumulative cost governor. No direct provider
// requests, credentials, speech calls, or customer identities appear here.
if(process.env.RECOVERY_PAID_VERIFICATION!=='authorized-up-to-5-usd')throw new Error('Explicit paid-verification opt-in required');
const scenario=process.argv[2]||'unit-circle';
const dir='docs/reviews/recovery/live';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch();
const privateState='.qa/live-browser-state.json';
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',...(existsSync(privateState)?{storageState:privateState}:{})});
const result:Record<string,unknown>={scenario,startedAt:new Date().toISOString(),transport:'real configured River text API via local cumulative US$5 governor',content:'isolated development copy of repository textbook; not certification of the production grade12 curriculum'};
let lastBase:BoardState={objects:[]};
async function ask(question:string,name:string):Promise<Lesson|null>{
 await page.getByRole('textbox',{name:'سؤالك للمعلم'}).fill(question);
 const pending=page.waitForResponse(r=>r.url().endsWith('/api/tutor')&&r.request().method()==='POST',{timeout:210000});
 await page.getByRole('button',{name:'أرسل السؤال',exact:true}).click();
 const response=await pending;
 const payload=await response.json();
 if(!response.ok()){result[name]={status:response.status(),message:payload.error??payload.message??'Request failed'};return null;}
 const {diagnostics: _diagnostics,...lesson}=payload;
 void _diagnostics;
 lastBase=lesson.mode==='followup'?response.request().postDataJSON().board:{objects:[]};
 writeFileSync(`${dir}/${name}.json`,JSON.stringify(lesson,null,2));
 result[name]={status:response.status(),title:lesson.title,segments:lesson.segments.length,assessment:lesson.assessment,math:lesson.segments.flatMap((s:Lesson['segments'][number])=>s.actions.filter(a=>a.type==='write_latex').map(a=>a.content)),sourcePages:lesson.sources.map((s:Lesson['sources'][number])=>s.pdfPage)};
 return lesson;
}
async function jump(lesson:Lesson,index:number,name:string){
 await page.getByRole('button',{name:'رحلة الحل',exact:true}).click();
 await page.locator('.steps button').nth(index).click();
 const state=runActions(beforeSegment(lastBase,lesson.segments,index),lesson.segments[index].actions);
 await page.waitForFunction(ids=>ids.every(id=>document.querySelector(`[data-object-id="${CSS.escape(id)}"]`)),state.objects.map(o=>o.id),{timeout:30000});
 if(await page.getByRole('button',{name:'إيقاف مؤقت',exact:true}).count())await page.getByRole('button',{name:'إيقاف مؤقت',exact:true}).click();
 await page.screenshot({path:`${dir}/${name}-1440.png`,fullPage:true});
 expect(await page.locator('.math-error').count()).toBe(0);
}
try{
 await page.route('**/api/speech',route=>route.fulfill({status:503,json:{error:'Live speech is not configured for this text-only provider.'}}));
 await page.goto('http://localhost:3012/api/auth/dev-login?target=student');
 await page.goto('http://localhost:3012/app/subjects/tawjihi-math/tutor');
 await expect(page.locator('.classroom')).toBeVisible();
 await page.getByRole('button',{name:'كتم صوت المعلم',exact:true}).click();
 if(scenario==='image'){
  let tutorCalls=0;page.on('request',request=>{if(request.url().endsWith('/api/tutor')&&request.method()==='POST')tutorCalls++;});
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/vision')&&r.request().method()==='POST',{timeout:100000});
  await page.locator('input[type="file"]').first().setInputFiles('qa/evidence/recovery-question.png');
  const response=await pending,payload=await response.json();result.vision={status:response.status(),question:payload.question??null,error:payload.error??null};
  expect(response.ok()).toBe(true);
  const composer=page.getByRole('textbox',{name:'سؤالك للمعلم'});await expect(composer).not.toHaveValue('');
  expect(tutorCalls).toBe(0);result.automaticSubmissions=tutorCalls;
  await page.screenshot({path:`${dir}/image-review-1440.png`,fullPage:true});
  const recognized=await composer.inputValue();expect(recognized.replace(/\s/g,'')).toMatch(/3(?:x|س)\+6=18/);
  const lesson=await ask(`${recognized}\nحل خطوة بخطوة وتحقق بالتعويض.`,'image-solution');
  if(lesson){assertVisualMath('3x+6=18',{objects:[]},lesson.segments);await jump(lesson,lesson.segments.length-1,'image-solution');}
 }else if(scenario.startsWith('unit-circle')){
  const alternate=scenario==='unit-circle-alt';
  const lesson=await ask(alternate?'اشرح دائرة الوحدة وارسم النقطة P=(0.8,-0.6) بدقة مع نصف القطر والزاوية والإسقاطين. أوجد الجيب وجيب التمام والظل وإشاراتها.':'اشرح دائرة الوحدة وارسمها بدقة مع النقطة P=(-0.6,0.8) ونصف القطر والزاوية وإسقاطات الإحداثيين. أوجد الجيب وجيب التمام والظل واشرح إشاراتها في الربع الثاني.',scenario);
  if(lesson){
   assertVisualMath(lesson.question,{objects:[]},lesson.segments);
   await jump(lesson,0,`${scenario}-start`);
   await jump(lesson,Math.floor((lesson.segments.length-1)/2),`${scenario}-middle`);
   await jump(lesson,lesson.segments.length-1,`${scenario}-complete`);
   const final=runActions(beforeSegment({objects:[]},lesson.segments,lesson.segments.length-1),lesson.segments.at(-1)!.actions);
   result.geometry=final.objects.filter(o=>o.region==='graph-area').map(o=>({id:o.id,type:o.type,points:o.points,geometry:o.geometry}));
   result.renderedCircleCount=await page.locator('.graph-draw_circle circle').count();
   await page.setViewportSize({width:390,height:900});await page.screenshot({path:`${dir}/${scenario}-complete-390.png`,fullPage:true});await page.setViewportSize({width:1440,height:1000});
   if(!alternate){
    const followup=await ask('ليش جيب التمام سالب هون؟ اشرحها أبسط واربطها بالنقطة اللي على الرسم.','unit-circle-followup');
    if(followup){expect(followup.mode).toBe('followup');await jump(followup,followup.segments.length-1,'unit-circle-followup');await expect(page.getByRole('button',{name:'العودة إلى الدرس · كمل الشرح',exact:true})).toBeVisible();await page.getByRole('button',{name:'العودة إلى الدرس · كمل الشرح',exact:true}).click();result.returnedToOriginal=await page.locator('.step-time').innerText();}
   }
  }
 }else{
  const questions:Record<string,string>={algebra:'حل المعادلة 3x+6=18 خطوة بخطوة واشرح لماذا نطرح ثم نقسم وتحقق من الحل بالتعويض.',misconception:'أنا أعتقد أن cos للزاوية في الربع الثاني موجب لأن نصف القطر موجب. هل فكرتي صحيحة؟ وضح الخطأ.',coach:'ساعدني أحل 3x+6=18. لا تعطيني الجواب، خليني أحاول الخطوة الأولى.',quiz:'اختبرني في المعادلة 3x+6=18، ولا تعرض الحل قبل محاولتي.',unsupported:'ما تاريخ تأسيس مدينة روما وتفاصيل أساطيرها وفق كتاب الرياضيات هذا؟'};
  if(scenario==='coach')await page.getByRole('button',{name:'ساعدني أحل',exact:true}).click();
  if(scenario==='quiz')await page.getByRole('button',{name:'اختبرني',exact:true}).click();
  const lesson=await ask(questions[scenario]??questions.algebra,scenario);
  if(lesson&&scenario==='algebra')assertVisualMath(lesson.question,{objects:[]},lesson.segments);
  if(lesson)await jump(lesson,lesson.segments.length-1,scenario);
  if(lesson&&scenario==='quiz'){
   const wrong=await ask('محاولتي x=5. هل الحل صحيح؟','quiz-wrong-attempt');if(wrong){expect(wrong.assessment?.correct).toBe(false);await jump(wrong,wrong.segments.length-1,'quiz-wrong-attempt');}
   const correct=await ask('صححت محاولتي: x=4. تحقق بالتعويض.','quiz-correct-attempt');if(correct){expect(correct.assessment?.correct).toBe(true);await jump(correct,correct.segments.length-1,'quiz-correct-attempt');}
  }
 }
 result.completedAt=new Date().toISOString();
}catch(e){result.verificationError=e instanceof Error?e.message:String(e);}
finally{writeFileSync(`${dir}/${scenario}-result.json`,JSON.stringify(result,null,2));writeFileSync(privateState,JSON.stringify(await page.context().storageState()),{mode:0o600});await browser.close();}
console.log(JSON.stringify(result,null,2));
