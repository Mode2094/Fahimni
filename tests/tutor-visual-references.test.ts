import {test} from 'node:test';
import assert from 'node:assert/strict';
import {teach} from '../lib/ai/tutor';
import type {AIProvider} from '../lib/ai/provider';
import type {Action} from '../schemas/lesson';
import {unitCircleFixture} from '../lib/whiteboard/recovery-fixtures';
import {beforeSegment} from '../lib/whiteboard/engine';

test('unit-circle follow-ups reuse verified notation while preserving the existing diagram',async()=>{
 let refs:string[]=[];
 const ai:AIProvider={
  json:async(system,input,schema)=>{
   // Reproduce the real provider incorrectly classifying this deictic turn as new.
   if(system.startsWith('Normalize'))return{searchQuery:'دائرة الوحدة جيب التمام في الربع الثاني',followup:false};
   assert.ok(!JSON.stringify(schema).includes('"draw_circle"'),'bound scenes offer references rather than raw drawing types to the provider');
   const context=input as {verifiedVisualRefs:{ref:string}[];retrieved:{id:string}[]};refs=context.verifiedVisualRefs.map(v=>v.ref);
   const a:Action={type:'use_visual',id:'cos-why',content:'cos',region:'working-area',targets:[],points:[],geometry:null,color:'blue',delayMs:0};
   return{title:'إشارة جيب التمام',mode:'followup',sufficientContext:true,message:'',assessment:null,segments:[{id:'why',goal:'نربط الإشارة بالمحور',narration:'النقطة يسار المحور الصادي لذلك الإحداثي السيني سالب.',sourceChunkIds:[context.retrieved[0].id],actions:[a]}]};
  },vision:async()=>null,transcribe:async()=>'',speak:async()=>new ArrayBuffer(0),
 };
 const board=beforeSegment({objects:[]},unitCircleFixture.segments,unitCircleFixture.segments.length);
 const lesson=await teach({question:'ليش جيب التمام سالب هون؟ اشرحها أبسط واربطها بالنقطة اللي على الرسم.',mode:'explain',subjectSlug:'tawjihi-math',subjectName:'رياضيات',board,history:[{question:'دائرة الوحدة P=(-0.6,0.8)',title:'دائرة الوحدة'}],currentStep:4,currentLesson:{title:'دائرة الوحدة',goals:[],narrations:[]}},undefined,ai);
 assert.ok(refs.includes('cos'));
 assert.equal(lesson.segments[0].actions[0].type,'write_latex');
 assert.equal(lesson.segments[0].actions[0].content,String.raw`\cos\theta=x=-0.6`);
 assert.equal(lesson.mode,'followup');
});

test('initial coaching asks for one student action instead of a multi-step monologue',async()=>{
 let attempts=0;
 const ai:AIProvider={json:async(system,input)=>{
  if(system.startsWith('Normalize'))return{searchQuery:'حل معادلة خطية',followup:false};
  const context=input as {retrieved:{id:string}[]};
  const segment={id:'start',goal:'اختيار العملية الأولى',narration:'شو العملية اللي تلغي زائد ستة من الطرفين؟',sourceChunkIds:[context.retrieved[0].id],actions:[{type:'write_latex',id:'eq',content:'3x+6=18',region:'working-area',targets:[],points:[],geometry:null,color:'ink',delayMs:0}]};
  attempts++;
  return{title:'نبدأ خطوة معًا',mode:'new',sufficientContext:true,message:'',assessment:null,segments:attempts===1?[segment,{...segment,id:'unnecessary'}]:[segment]};
 },vision:async()=>null,transcribe:async()=>'',speak:async()=>new ArrayBuffer(0)};
 const lesson=await teach({question:'ساعدني أحل 3x+6=18 دون إعطائي الجواب',mode:'coach',subjectSlug:'tawjihi-math',board:{objects:[]},history:[],currentStep:0,currentLesson:null},undefined,ai);
 assert.equal(lesson.segments.length,1);
 assert.equal(attempts,2);
});

test('quiz grading checks the displayed original equation even when spoken feedback contains no equation',async()=>{
 for(const [question,correct] of [['محاولتي x=4',true],['محاولتي x=5',false]] as const){
  const ai:AIProvider={json:async(system,input)=>{
   if(system.startsWith('Normalize'))return{searchQuery:'المعادلات الخطية',followup:true};
   const context=input as {retrieved:{id:string}[]};
   return{title:'تقييم المحاولة',mode:'followup',sufficientContext:true,message:'',assessment:{correct:!correct,topic:'المعادلات الخطية',misconception:null,nextReviewInDays:2},segments:[{id:'feedback',goal:'نراجع المحاولة',narration:'نراجع الحل بالتعويض في المعادلة الأصلية.',sourceChunkIds:[context.retrieved[0].id],actions:[{type:'write_text',id:'feedback',content:'نراجع المحاولة بالتعويض',region:'explanation-area',targets:[],points:[],geometry:null,color:'ink',delayMs:0}]}]};
  },vision:async()=>null,transcribe:async()=>'',speak:async()=>new ArrayBuffer(0)};
  const board={objects:[{id:'original',type:'write_latex' as const,content:'3x+6=18',region:'working-area' as const,targets:[],points:[],geometry:null,color:'ink' as const,highlighted:false,focused:false,group:null}]};
  const lesson=await teach({question,mode:'quiz',subjectSlug:'tawjihi-math',board,history:[{question:'اختبرني في 3x+6=18',title:'المعادلات الخطية'}],currentStep:0,currentLesson:{title:'المعادلات الخطية',goals:[],narrations:[]}},undefined,ai);
  assert.equal(lesson.assessment?.correct,correct);
 }
});
