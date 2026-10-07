import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Lesson,Segment} from '../schemas/lesson';
import {VISUAL_DEV_MODE,fixtureLesson,fixtureFollowup,fixtureSpeech} from '../lib/whiteboard/fixtures';
import {generatedLessonSchema} from '../schemas/lesson';
import {validateActions,runActions,beforeSegment} from '../lib/whiteboard/engine';
import {deriveTeachingStates,idsForSegment,pointerTarget,speechNarration,isAnnotation,isMath} from '../lib/whiteboard/teaching-state';
import {isGlyph} from '../components/whiteboard/TeachingAnnotation';
import {planLayout,zoneOf,rowsFor,zoneWeight} from '../lib/whiteboard/layout';
import {scheduleActions,prefersReducedMotion} from '../lib/whiteboard/animation';

// beforeSegment(board, segments, n) applies the first n segments, so a lesson
// that is fully revealed has n === segments.length.
const at=(n:number)=>beforeSegment({objects:[]},fixtureLesson.segments,n);
const ctxFor=(n:number,board=at(n))=>{const ids=idsForSegment(fixtureLesson.segments[n-1]?.actions??[]);return{objects:board.objects,index:n-1,segments:fixtureLesson.segments.map(s=>({actions:s.actions})),status:'playing',activeIds:ids.active,focusedIds:ids.focused,highlightedIds:ids.highlighted,finalIds:ids.final};};

test('visual dev mode is opt-in and off by default',()=>{
 assert.equal(typeof VISUAL_DEV_MODE,'boolean');
 if(!process.env.NEXT_PUBLIC_VISUAL_DEV_MODE)assert.equal(VISUAL_DEV_MODE,false);
});

test('fixture lesson satisfies the real server schema and board validation',()=>{
 // Strip presentation-only fields: the generated schema is strict, exactly as
 // a real /api/tutor response would be, so the fixture must match it.
  const payloadFor=(lesson:Lesson)=>({title:lesson.title,mode:lesson.mode,sufficientContext:lesson.sufficientContext,message:lesson.message,segments:lesson.segments.map((s:Segment)=>({id:s.id,narration:s.narration,goal:s.goal,sourceChunkIds:s.sourceChunkIds,actions:s.actions}))});
 const images=fixtureLesson.sources.map(s=>s.image);
 const parsed=generatedLessonSchema.parse(payloadFor(fixtureLesson));
 assert(parsed.segments.length>0);
 // A new lesson is validated against an empty board, as the server does.
 validateActions({objects:[]},parsed.segments,images);
 // A follow-up is validated against the board it continues, so it may only
 // reference objects that actually exist at that point.
 const followUp=generatedLessonSchema.parse(payloadFor(fixtureFollowup));
 const base=beforeSegment({objects:[]},fixtureLesson.segments,4);
 validateActions(base,followUp.segments,images);
 assert.equal(fixtureLesson.segments.length,6);
});

test('fixture reproduces a real teaching arc: math, annotations, focus, sources, final answer',()=>{
 const actions=fixtureLesson.segments.flatMap(s=>s.actions);
 assert(actions.some(a=>a.type==='write_latex'),'has latex');
 assert(actions.some(a=>a.type==='highlight'),'has highlight');
 assert(actions.some(a=>a.type==='draw_rectangle'),'has box annotation');
 assert(actions.some(a=>a.type==='draw_line'),'has underline/strike annotation');
 assert(actions.some(a=>a.type==='focus_object'),'has focus');
 assert(actions.some(a=>a.region==='result-area'),'has a result area object');
 for(const s of fixtureLesson.segments){
  assert(s.narration.trim().length>0,'narration present');
  assert(s.sourceChunkIds.length>0,'source referenced');
  assert(s.sources.length>0,'resolved sources attached');
 }
 assert(fixtureSpeech('step1').length>0);
 assert.equal(speechNarration(fixtureLesson,0),fixtureLesson.segments[0].narration);
});

test('teaching states: active step dominates, earlier steps complete, future hidden',()=>{
 const board=at(3);
 const states=deriveTeachingStates(ctxFor(3,board));
 assert(states.size===board.objects.length);
 const emphasised=[...states.values()].filter(s=>s==='active'||s==='focused'||s==='highlighted');
 assert(emphasised.length>0,'current step is emphasised');
 assert([...states.values()].filter(s=>s==='completed').length>0,'earlier steps stay visible but recede');
 // Nothing from a future segment may be on the board yet.
 for(const id of fixtureLesson.segments.slice(3).flatMap(s=>s.actions.map(a=>a.id).filter(Boolean))){
  assert(!board.objects.some(o=>o.id===id),`${id} must not appear early`);
 }
});

test('pointer and layout follow the active step rather than DOM order',()=>{
 const board=at(2);
 const ctx=ctxFor(2,board);
 const target=pointerTarget(ctx);
 assert(target&&board.objects.some(o=>o.id===target),'pointer rests on a real object');
 const states=deriveTeachingStates(ctx);
 const plan=planLayout({board,states,index:1,total:6});
 assert.equal(plan.focus,'work');
 const zones=new Set(plan.zones.map(z=>z.zone));
 assert(zones.has('header')&&zones.has('work'),'header and work zones planned');
 assert.equal(zoneWeight('work','work',true),1);
 assert(zoneWeight('result','work',true)<1,'result recedes while teaching continues');
 // At the end the answer takes over as the focal zone.
 const end=at(6);
 const endCtx=ctxFor(6,end);
 const endStates=deriveTeachingStates(endCtx);
 assert([...endStates.values()].includes('final'),'the concluded answer reads as final');
 assert.equal(planLayout({board:end,states:endStates,index:5,total:6}).focus,'result');
});

test('branching renders pedagogically: an invalid branch is marked and recedes',()=>{
 const board=at(6);
 const dead=board.objects.find(o=>o.id==='branch-negative');
 const live=board.objects.find(o=>o.id==='branch-valid');
 assert(dead&&live,'both branches labelled');
 assert(/لا حل حقيقي/.test(dead!.content),'dead branch says no real solution');
 assert(live&&/حل حقيقي/.test(live.content),'valid branch is contrasted');
 assert(board.objects.some(o=>o.id==='cross-negative'),'dead branch is struck through');
 const states=deriveTeachingStates(ctxFor(6,board));
 assert.equal(states.get('branch-negative'),'completed');
 assert.equal(states.get('eq-roots'),'final');
 // The valid branch carries the emphasis the dead one no longer has.
 assert.notEqual(states.get('branch-valid'),'final');
});

test('follow-up preserves the board instead of erasing it',()=>{
 const before=at(4);
 const after=runActions(before,fixtureFollowup.segments[0].actions);
 assert.equal(after.objects.length,before.objects.length+2,'only the new annotation and note are added');
 assert(before.objects.every(o=>after.objects.some(n=>n.id===o.id)),'existing objects preserved');
 assert(fixtureFollowup.mode==='followup');
 const focus=fixtureFollowup.segments[0].actions.find(a=>a.type==='focus_object');
 assert(focus?.targets.some(t=>before.objects.some(o=>o.id===t)),'references an object already on the board');
});

test('action timing spreads a step across its narration instead of firing at once',()=>{
 assert.equal(prefersReducedMotion(),false,'node has no window, so motion is on');
 const types=fixtureLesson.segments[1].actions.map(a=>a.type);
 const timing=scheduleActions(types.length,9000,types);
 assert.equal(timing.length,types.length);
 assert(timing[0].at<timing[1].at,'actions are staggered');
 assert(timing.every(t=>t.at<=9000),'all land within the step');
 const focusIndex=types.indexOf('focus_object');
 if(focusIndex>0)assert(timing[focusIndex].at>timing[0].at,'focus arrives after the first reveal');
 // Reduced motion collapses the schedule rather than breaking it.
 const saved=globalThis.window;
 globalThis.window={matchMedia:()=>({matches:true,media:'',onchange:null,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){},dispatchEvent(){return false;}})} as unknown as Window & typeof globalThis;
 try{
  assert.equal(prefersReducedMotion(),true);
  const flat=scheduleActions(types.length,9000,types);
  assert.equal(flat.length,types.length);
  assert(flat.every(t=>t.at===0),'no stagger under reduced motion');
 }finally{globalThis.window=saved;}
});

test('helpers classify objects and group annotation glyphs with their line',()=>{
 const board=at(6);
 const box=board.objects.find(o=>o.id==='box-final')!;
 assert(box&&isAnnotation(box),'a box is an annotation, not new maths');
 const eq=board.objects.find(o=>o.id==='eq-roots')!;
 assert(isMath(eq),'latex is maths');
 assert.equal(zoneOf(eq),'result');
 const rows=rowsFor(board.objects.filter(o=>o.region==='result-area'));
 assert(rows.length>=1);
 // Glyphs attach to the maths they mark instead of forming rows of their own.
 const workRows=rowsFor(board.objects.filter(o=>o.region==='working-area'));
 assert(workRows.every(r=>r.length>0));
 assert.equal(typeof zoneWeight('history','work',false),'number');
});

test('a glyph shares a row, and so a region, with the object it frames',()=>{
 const board=at(6);
 const framed=(glyphId:string)=>{
  for(const zone of ['top','working-area','explanation-area','result-area']){
   for(const row of rowsFor(board.objects.filter(o=>o.region===zone))){
    if(row.some(o=>o.id===glyphId)){
     const maths=row.filter(o=>!isGlyph(o)&&o.type!=='draw_line'&&o.type!=='draw_arrow');
     if(maths.length)return maths[0].id;
    }
   }
  }
  return null;
 };
 // The closing box must frame the answer, not the label beside it.
 assert.equal(framed('box-final'),'eq-roots');
 assert.equal(framed('box-a'),'eq-factor-1');
 assert.equal(framed('box-9'),'eq-factor-2');
 // The dead branch is struck through, on the line that explains it.
 assert.equal(framed('cross-negative'),'lbl-imaginary');
 // And every glyph sits in the same region as what it frames.
 for(const id of ['box-a','box-9','box-final','cross-negative']){
  const glyph=board.objects.find(o=>o.id===id)!;
  const target=board.objects.find(o=>o.id===framed(id))!;
  assert.equal(glyph.region,target.region,`${id} region matches its target`);
 }
 // A glyph drawn during the current step reads as part of it, not as leftover.
 const atStep5=deriveTeachingStates(ctxFor(5,at(5)));
 assert.equal(atStep5.get('cross-negative'),'active','strike-through belongs to the step that drew it');
 const atStep6=deriveTeachingStates(ctxFor(6,at(6)));
 assert.equal(atStep6.get('cross-negative'),'completed','and recedes on the next step');
});
