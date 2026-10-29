import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {POST as tutor} from '../app/api/tutor/route';
import {POST as vision} from '../app/api/vision/route';
import {POST as transcribe} from '../app/api/transcribe/route';
import {POST as speech} from '../app/api/speech/route';
import {sameOrigin} from '../lib/http';
import {setSettingsReaderForTests} from '../lib/settings/service';
import {createMemoryLimiter, setRateLimiterForTests} from '../lib/rate-limit/limiter';
import {createMemoryDailyBudget, setAiBudgetForTests} from '../lib/ai/budget';
import {createMemoryTrialBudget, setTrialBudgetForTests} from '../lib/trial/budget';
// The AI routes read runtime config and apply rate limits / budgets. In CI a
// real Redis or database connection would leave a pending command that cancels
// sibling tests; use the in-memory doubles instead.
setSettingsReaderForTests({getPlain:async()=>null,getSecret:async()=>null,getSecretPresence:async()=>false});
setRateLimiterForTests(createMemoryLimiter());
setAiBudgetForTests(createMemoryDailyBudget('ai-test'));
setTrialBudgetForTests(createMemoryTrialBudget());
const question='حل x^3 + 4x^2 = 5x';
const action={type:'write_latex',id:'eq1',content:'x(x+5)(x-1)=0',region:'working-area',targets:[],points:[],color:'ink',geometry:null,delayMs:0};
const jsonRequest=(path:string,body:unknown)=>new Request('https://local/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const uploadRequest=(path:string,file:File)=>{const f=new FormData();f.set('file',file);return new Request('https://local/'+path,{method:'POST',body:f});};
test('server integration: text, image recognition→grounding, transcription→grounding, per-segment TTS; simulated provider transport only',async()=>{
 const original=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only-never-real';const calls:string[]=[];
 globalThis.fetch=async(input,init)=>{const url=String(input);calls.push(url);if(url.endsWith('audio/transcriptions'))return Response.json({text:question});if(url.endsWith('audio/speech'))return new Response(new Uint8Array([73,68,51,0,0,0]),{headers:{'Content-Type':'audio/mpeg'}});const b=JSON.parse(init?.body as string),system=b.messages[0].content;
 let result;if(system.startsWith('Read this student'))result={clear:true,question};else if(system.startsWith('Normalize'))result={searchQuery:'حل معادلات خاصة '+question,followup:false};else{const user=JSON.parse(b.messages[1].content);const id=user.retrieved[0].id;result={title:'حل معادلة خاصة',mode:'new',sufficientContext:true,assessment:null,message:'',segments:[{id:'s1',goal:'نحلل',narration:'نحلل المقدار الجبري إلى عوامله.',sourceChunkIds:[id],actions:[action]},{id:'s2',goal:'نستنتج الحلول',narration:'إذن الحلول هي صفر وسالب خمسة وواحد.',sourceChunkIds:[id],actions:[{...action,id:'eq2',content:'x=0\\ \\text{أو}\\ x=-5\\ \\text{أو}\\ x=1'}]},{id:'s3',goal:'نتحقق',narration:'نتحقق بتعويض أحد الحلول في المعادلة الأصلية.',sourceChunkIds:[id],actions:[{...action,id:'eq3',content:'0+0=0'}]}]};}
 return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});};
 try{
 const image=await vision(uploadRequest('api/vision',new File([fs.readFileSync('assets/legacy-textbook/8.jpg')],'exercise.jpg',{type:'image/jpeg'})));assert.equal(image.status,200);const imageText=(await image.json() as {question:string}).question;
 const audio=await transcribe(uploadRequest('api/transcribe',new File([new Uint8Array([26,69,223,163,0,0,0])],'question.webm',{type:'audio/webm'})));assert.equal(audio.status,200);const audioText=(await audio.json() as {question:string}).question;
 for(const input of [question,imageText,audioText]){const result=await tutor(jsonRequest('api/tutor',{question:input,board:{objects:[]},history:[],currentStep:0,currentLesson:null}));assert.equal(result.status,200);const lesson=await result.json() as {sources:{pdfPage:number}[];segments:{actions:{type:string}[]}[]};assert.equal(lesson.sources[0].pdfPage,8);assert.equal(lesson.segments[0].actions[0].type,'write_latex');}
 const spoken=await speech(jsonRequest('api/speech',{text:'نحلل المقدار الجبري.'}));assert.equal(spoken.status,200);assert.equal(spoken.headers.get('content-type'),'audio/mpeg');assert((await spoken.arrayBuffer()).byteLength>0);
 assert(calls.some(x=>x.endsWith('audio/speech')));assert(calls.some(x=>x.endsWith('audio/transcriptions')));
 }finally{globalThis.fetch=original;if(key)process.env.OPENAI_API_KEY=key;else delete process.env.OPENAI_API_KEY;}
});
test('HTTP layer rejects foreign origins, malformed JSON and reports missing key',async()=>{const key=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;try{const req=jsonRequest('api/tutor',{question,board:{objects:[]},history:[],currentStep:0,currentLesson:null});assert.equal((await tutor(req)).status,503);const forged=new Request('https://local/api/tutor',{method:'POST',headers:{Origin:'https://foreign.invalid'},body:'{}'});assert.equal((await tutor(forged)).status,403);assert.equal((await tutor(new Request('https://local/api/tutor',{method:'POST',body:'bad'}))).status,400);}finally{if(key)process.env.OPENAI_API_KEY=key;}});
test('same-origin check trusts Host, never a forged X-Forwarded-Host',()=>{
 // req.url is rebuilt from the bind address, so a 0.0.0.0 dev server must still
 // accept the real page origin that the browser reports.
 const devBind=new Request('http://0.0.0.0:3000/api/vision',{headers:{Host:'localhost:3000',Origin:'http://localhost:3000'}});
 assert.equal(sameOrigin(devBind),true);
 assert.equal(sameOrigin(new Request('http://0.0.0.0:3000/api/vision',{headers:{Host:'127.0.0.1:3000',Origin:'http://127.0.0.1:3000'}})),true);
 assert.equal(sameOrigin(new Request('http://0.0.0.0:3000/api/vision',{headers:{Host:'192.168.1.20:3000',Origin:'http://192.168.1.20:3000'}})),true);
 // TLS terminated upstream: the proxy reports the public scheme.
 assert.equal(sameOrigin(new Request('http://internal:3000/api/vision',{headers:{Host:'fahimni.app',Origin:'https://fahimni.app','X-Forwarded-Proto':'https'}})),true);
 // No Origin header: same-origin navigations and non-browser clients.
 assert.equal(sameOrigin(new Request('http://0.0.0.0:3000/api/vision')),true);
 // Genuine cross-origin traffic stays blocked.
 assert.equal(sameOrigin(new Request('http://0.0.0.0:3000/api/vision',{headers:{Host:'localhost:3000',Origin:'https://evil.example'}})),false);
 assert.equal(sameOrigin(new Request('http://0.0.0.0:3000/api/vision',{headers:{Host:'localhost:3000',Origin:'null'}})),false);
 assert.equal(sameOrigin(new Request('http://0.0.0.0:3000/api/vision',{headers:{Host:'localhost:3000',Origin:'http://localhost:4000'}})),false);
 assert.equal(sameOrigin(new Request('http://0.0.0.0:3000/api/vision',{headers:{Host:'fahimni.app',Origin:'http://fahimni.evil.app'}})),false);
 // A caller can forge X-Forwarded-Host, so it must never widen what is accepted.
 assert.equal(sameOrigin(new Request('http://0.0.0.0:3000/api/vision',{headers:{Host:'localhost:3000',Origin:'http://evil.example','X-Forwarded-Host':'evil.example'}})),false);
});

test('textbook excerpt endpoint is development-only and requires a session', async () => {
 const { GET: bookExcerpt } = await import('../app/api/book/route');
 // Anonymous callers never receive textbook excerpts (development).
 const anonymous = await bookExcerpt(new Request('https://local/api/book?q=معادلة'));
 assert.equal(anonymous.status, 401);
 assert.equal((await anonymous.text()).includes('excerpt'), false);
 // Production closes the legacy surface entirely, for every caller.
 const previous = process.env.NODE_ENV;
 (process.env as unknown as Record<string, string | undefined>).NODE_ENV = 'production';
 try {
  assert.equal((await bookExcerpt(new Request('https://local/api/book?q=معادلة'))).status, 404);
 } finally {
  if (previous === undefined) delete (process.env as unknown as Record<string, string | undefined>).NODE_ENV;
  else (process.env as unknown as Record<string, string | undefined>).NODE_ENV = previous;
 }
});
