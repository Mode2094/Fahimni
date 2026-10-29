'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import katex from 'katex';
import type {Action,BoardObject,BoardState,Lesson} from '../../schemas/lesson';
import {deriveTeachingStates,idsForSegment,isAnnotation,isMath,pointerTarget,type TeachingVisualState} from '../../lib/whiteboard/teaching-state';
import {planLayout,rowsFor,zoneWeight,type Zone} from '../../lib/whiteboard/layout';
import {useReducedMotion} from '../../lib/whiteboard/useReducedMotion';
import TeachingAnnotation,{isGlyph,useGlyphFrames,type GlyphPair} from './TeachingAnnotation';
import GraphLayer from './GraphLayer';

// Board palette mapped onto design tokens so the teaching surface themes from one
// place. `ink` is chalk-white on the dark board, not black ink.
const PALETTE={
 ink:'var(--chalk-main)',blue:'var(--chalk-blue)',teal:'var(--chalk-teal)',
 amber:'var(--chalk-accent)',red:'var(--chalk-warn)',
}as const;

const GRAPHICS=new Set<Action['type']>(['draw_line','draw_arrow','draw_circle','draw_rectangle','draw_axes','plot_point','plot_points','plot_graph']);

/* ---------------------------------------------------------------- math ---- */

export function MathText({text,state,inline=false,fallback='error'}:{text:string;state?:TeachingVisualState;inline?:boolean;fallback?:'error'|'text'}){
 const html=useMemo(()=>{
  try{return katex.renderToString(text,{throwOnError:true,trust:false,strict:'ignore',displayMode:!inline,maxSize:10,maxExpand:500});}
  catch{return null;}
 },[text,inline]);
 // Question text may contain mixed Arabic and escaped or unescaped LaTeX. When
 // KaTeX cannot parse it, the fallback keeps the student's own words intact
 // instead of showing an error box.
 if(!html)return fallback==='text'?<span className="question-math-text" dir="auto">{text}</span>:<span className="math-error">تعذّر عرض هذا التعبير الرياضي. اطلب إعادة صياغته.</span>;
 // KaTeX markup stays untouched and crisp: only opacity/transform animate, never
 // a filter or blur, so the maths is never made harder to read.
 return <div className={inline?'math math--inline':'math'} dir="ltr" data-state={state} dangerouslySetInnerHTML={{__html:html}}/>;
}

/* -------------------------------------------------------------- pointer --- */

// A small chalk focus mark that rests on whatever the teacher is discussing.
// Deliberately not a cursor and not a laser: a soft dot with a breathing ring.
function TeacherPointer({targetId,host}:{targetId:string|null;host:React.RefObject<HTMLDivElement|null>}){
 const node=useRef<HTMLDivElement|null>(null);
 const el0=host.current;
 useEffect(()=>{
  const el=node.current;if(!el)return;
  const find=()=>{
   if(!targetId||typeof document==='undefined')return null;
   const sel=typeof CSS!=='undefined'&&typeof CSS.escape==='function'?CSS.escape(targetId):targetId.replace(/["\\]/g,'\\$&');
   return document.querySelector<HTMLElement>(`[data-object-id="${sel}"]`);
  };
  const target=find();
  const place=(final:boolean)=>{
   if(!target||!el0){el.dataset.active='false';return;}
   const r=target.getBoundingClientRect(),h=el0.getBoundingClientRect();
   if(!r.width){el.dataset.active='false';return;}
   el.style.setProperty('--px',`${r.left-h.left+el0.scrollLeft+Math.min(r.width/2,160)}px`);
   el.style.setProperty('--py',`${r.top-h.top+el0.scrollTop+r.height+3}px`);
   if(final)el.dataset.active='true';
  };
  place(false);
  const settle=setTimeout(()=>place(true),360);
  const onChange=()=>place(true);
  window.addEventListener('resize',onChange);
  el0?.addEventListener('scroll',onChange,{passive:true});
  return()=>{clearTimeout(settle);window.removeEventListener('resize',onChange);el0?.removeEventListener('scroll',onChange);};
 },[targetId,el0]);
 return <div className="teacher-pointer" ref={node} data-active="false" aria-hidden="true"><span className="pointer-ring"/><span className="pointer-dot"/></div>;
}

/* -------------------------------------------------------------- objects --- */

function BoardItem({o,state,onSelect,ghost=false}:{o:BoardObject;state:TeachingVisualState;onSelect:(o:BoardObject)=>void;ghost?:boolean}){
 if(GRAPHICS.has(o.type))return null; // Graph glyphs render in the graph layer.
 const body=o.type==='write_latex'
  ?<MathText text={o.content} state={state}/>
  :o.type==='show_image'
  ?<img className="source-image" src={o.content} alt="صفحة مسترجعة من الكتاب"/>
  :<span className="object-label">{o.content}</span>;
 const writeDir=o.type==='write_latex'||isMath(o)?'ltr':'rtl';
 return <div
  className={`board-object type-${o.type} state-${state}${isAnnotation(o)?' is-annotation':''}${isMath(o)?' is-math':''}${ghost?' is-erasing':''}`}
  data-object-id={o.id} data-group={o.group||undefined} data-state={state} data-write-dir={writeDir}
  tabIndex={0} role="button" aria-label={'اسأل عن '+(o.content||'هذا العنصر')}
  onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(o);}}}
  onClick={()=>onSelect(o)}
  style={{'--tone':PALETTE[o.color]} as React.CSSProperties}
 >{body}{state==='final'&&<span className="final-underline" aria-hidden="true"/>}</div>;
}

/* --------------------------------------------------------------- zones ---- */

function Zone({zone,objects,states,weight,focus,onSelect,ghostIds}:{
 zone:Zone;objects:BoardObject[];states:Map<string,TeachingVisualState>;weight:number;focus:boolean;
 onSelect:(o:BoardObject)=>void;ghostIds:Set<string>;
}){
 const rows=rowsFor(objects);
 const graphObjects=objects.filter(o=>o.region==='graph-area'&&GRAPHICS.has(o.type));
 if(!rows.length&&!graphObjects.length)return null;
 return <section className={`board-zone zone-${zone}${focus?' is-focus':''}`} data-zone={zone} style={{'--zone-weight':weight} as React.CSSProperties}>
  {graphObjects.length?<GraphLayer objects={graphObjects} ghostIds={ghostIds}/>:null}
  {rows.map((row,i)=><div className="board-row" key={row.map(o=>o.id).join('|')||i}>
   {row.filter(o=>!GRAPHICS.has(o.type)).map(o=><div className="row-item" key={o.id}><BoardItem o={o} state={states.get(o.id)??'inactive'} onSelect={onSelect} ghost={ghostIds.has(o.id)}/></div>)}
  </div>)}
 </section>;
}

/* --------------------------------------------------------------- board ---- */

export default function SmartBoard({board,lesson=null,index=0,status='idle',onSelect,scale=1,voiceActive=false,voiceLevel=0.2,children}:{
 board:BoardState;lesson?:Lesson|null;index?:number;status?:string;onSelect:(o:BoardObject)=>void;
 scale?:number;voiceActive?:boolean;voiceLevel?:number;children?:React.ReactNode;
}){
 const reduced=useReducedMotion();
 const segment=lesson?.segments[index];
 const{states,pointer}=useMemo(()=>{
  const ids=idsForSegment(segment?.actions??[]);
  const ctx={objects:board.objects,index,segments:(lesson?.segments??[]).map(s=>({actions:s.actions})),status,activeIds:ids.active,focusedIds:ids.focused,highlightedIds:ids.highlighted,finalIds:ids.final};
  return{states:deriveTeachingStates(ctx),pointer:pointerTarget(ctx)};
 },[board.objects,segment,index,lesson,status]);
 // Erase transitions: objects that disappear from the board stay on screen for
 // a short chalk-fade instead of vanishing between two frames.
 const[ghosts,setGhosts]=useState<BoardObject[]>([]);
 const previous=useRef<BoardObject[]>([]);
 useEffect(()=>{
  const before=previous.current;previous.current=board.objects;
  const live=new Set(board.objects.map(o=>o.id));
  const removed=before.filter(o=>!live.has(o.id));
  if(!removed.length)return;
  setGhosts(removed);
  const timer=setTimeout(()=>setGhosts([]),280);
  return()=>clearTimeout(timer);
 },[board.objects]);
 const displayBoard=useMemo(()=>{
   if(!ghosts.length)return board;
   // An erased object can come back (re-written with the same id) inside the
   // fade window; a ghost that is live again must not be shown twice, or the
   // board would hold two objects with one id and React would see duplicate keys.
   const live=new Set(board.objects.map(o=>o.id));
   const fading=ghosts.filter(o=>!live.has(o.id));
   return fading.length?{objects:[...board.objects,...fading]}:board;
  },[board,ghosts]);
 const ghostIds=useMemo(()=>new Set(ghosts.map(o=>o.id)),[ghosts]);
 const plan=useMemo(()=>planLayout({board:displayBoard,states,index,total:lesson?.segments.length??0}),[displayBoard,states,index,lesson]);
 const hasFuture=index<(lesson?.segments.length??1)-1;
 const scroll=useRef<HTMLDivElement|null>(null);
 const content=useRef<HTMLDivElement|null>(null);
 const[host,setHost]=useState<HTMLElement|null>(null);

 // Each glyph frames the first maths object sharing its row, which is exactly
 // how the layout engine groups them. Resolved by id, so no element state.
 const pairs=useMemo<GlyphPair[]>(()=>{
  const out:GlyphPair[]=[];
  for(const{objects}of plan.zones){
   for(const row of rowsFor(objects)){
    const glyphs=row.filter(isGlyph);
    if(!glyphs.length)continue;
    const target=row.find(o=>!GRAPHICS.has(o.type));
    if(!target)continue;
    for(const glyph of glyphs)out.push({glyph,targetId:target.id,state:states.get(glyph.id)??'inactive'});
   }
  }
  return out;
 },[plan,states]);
 const frames=useGlyphFrames(pairs,host);

 // Keep the active line in the student's focal band, smoothly and only when it
 // has actually drifted out of comfortable reading position. Measured with
 // rects rather than offsetTop so it is correct regardless of offset parent.
 useEffect(()=>{
  if(status!=='playing'&&status!=='paused')return;
  const el=scroll.current;if(!el)return;
  const zone=el.querySelector<HTMLElement>('.board-zone.is-focus');
  const target=zone?.querySelector<HTMLElement>('.state-active,.state-focused,.state-final')??zone;
  if(!target||!zone)return;
  const hr=el.getBoundingClientRect(),tr=target.getBoundingClientRect();
  const top=tr.top-hr.top+el.scrollTop,band=el.clientHeight;
  if(top<el.scrollTop+band*0.16||top>el.scrollTop+band*0.6)el.scrollTo({top:Math.max(0,top-band*0.32),behavior:reduced?'auto':'smooth'});
 },[board,status,reduced]);

 useEffect(()=>{setHost(content.current);},[]);

 return <div className={`board-stage${voiceActive?' is-speaking':''}`} style={{'--board-scale':scale} as React.CSSProperties}>
  <div className="board-frame">
   <div className="board-surface" aria-hidden="true"><span className="grain"/><span className="residue"/><span className="vignette"/></div>
   <div className="board-scroll" ref={scroll} dir="rtl">
    <div className="board-content" ref={content}>
     {plan.zones.map(z=><Zone key={z.zone} zone={z.zone} objects={z.objects} states={states} weight={zoneWeight(z.zone,plan.focus,hasFuture)} focus={z.zone===plan.focus} onSelect={onSelect} ghostIds={ghostIds}/>)}
     {!board.objects.length&&children}
    </div>
    <TeachingAnnotation pairs={pairs} frames={frames}/>
   </div>
   <TeacherPointer targetId={pointer} host={content}/>   {voiceActive&&<div className="voice-wave" aria-hidden="true">{[0,1,2,3].map(i=><span key={i} style={{'--i':i,'--level':voiceLevel} as React.CSSProperties}/>)}</div>}
  </div>
 </div>;
}
