'use client';
import {useEffect,useState} from 'react';
import type {BoardObject} from '../../schemas/lesson';
import {isAnnotation} from '../../lib/whiteboard/teaching-state';
import type {TeachingVisualState} from '../../lib/whiteboard/teaching-state';

// Teaching glyphs are drawn in a board-level overlay measured against the
// object they belong to, so a box actually frames the equation instead of
// stretching across the row. The action geometry is interpreted as a normalised
// padding guide (0–100 within the framed object), which is what the engine's
// "0–100 inside its own canvas" contract means for a non-graph object.

export interface GlyphPair{
 glyph:BoardObject;
 targetId:string;
 state:TeachingVisualState;
}

interface Frame{left:number;top:number;width:number;height:number}

const same=(a:Map<string,Frame>,b:Map<string,Frame>)=>{
 if(a.size!==b.size)return false;
 for(const[id,f] of b){const p=a.get(id);if(!p||Math.abs(p.left-f.left)>.75||Math.abs(p.top-f.top)>.75||Math.abs(p.width-f.width)>.75||Math.abs(p.height-f.height)>.75)return false;}
 return true;
};

const esc=(v:string)=>(typeof CSS!=='undefined'&&typeof CSS.escape==='function')?CSS.escape(v):v.replace(/["\\]/g,'\\$&');

// jsdom and other non-visual environments have no rAF/ResizeObserver, so both
// are optional. Degrading to a timer keeps the board renderable everywhere.
const scheduleFrame=(fn:()=>void)=>{
 if(typeof requestAnimationFrame==='function')return{run:()=>requestAnimationFrame(fn),cancel:(h:number)=>cancelAnimationFrame(h)};
 return{run:()=>setTimeout(fn,16) as unknown as number,cancel:(h:number)=>clearTimeout(h)};
};
const ResizeObserverCtor=typeof ResizeObserver==='function'?ResizeObserver:null;

/**
 * Measures each glyph against the object it frames. Targets are resolved by DOM
 * query rather than held in React state: a ref callback storing elements re-runs
 * on every render, and observing the very overlay we write feeds measurements
 * back into layout and loops.
 */
export function useGlyphFrames(pairs:GlyphPair[],host:HTMLElement|null){
 const[frames,setFrames]=useState<Map<string,Frame>>(new Map());
 useEffect(()=>{
  // Clearing happens after paint rather than in the effect body, so a board that
  // loses its host does not cascade a render.
  if(!host){const t=setTimeout(()=>setFrames(new Map()),0);return()=>clearTimeout(t);}
  const root:HTMLElement=host;
  let frame=0;
  const raf=scheduleFrame(measure);
  function measure(){
   frame=0;
   const base=root.getBoundingClientRect();
   const next=new Map<string,Frame>();
   for(const{glyph,targetId}of pairs){
    const target=root.querySelector<HTMLElement>(`[data-object-id="${esc(targetId)}"]`);
    if(!target)continue;
    const r=target.getBoundingClientRect();
    if(!r.width)continue;
    next.set(glyph.id,{left:r.left-base.left,top:r.top-base.top,width:r.width,height:r.height});
   }
   // Post-layout measurement, not a cascading render: measure() only runs from a
   // frame, a ResizeObserver or a scroll event, and the set bails out unless the
   // geometry actually moved.
   setFrames(prev=>same(prev,next)?prev:next);
  }
  // Always deferred: measured in a frame, never synchronously in the effect body.
  const schedule=()=>{if(!frame)frame=raf.run();};
  schedule();
  const settle=setTimeout(schedule,380);
  const ro=ResizeObserverCtor?new ResizeObserverCtor(schedule):null;
  ro?.observe(root);
  for(const{targetId}of pairs){
   const el=host.querySelector(`[data-object-id="${esc(targetId)}"]`);
   if(el)ro?.observe(el);
  }
  const scroller=root.closest('.board-scroll')??host;
  scroller.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule);
  return()=>{raf.cancel(frame);clearTimeout(settle);ro?.disconnect();scroller.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);};
 },[host,pairs]);
 return frames;
}

const TONE:Record<BoardObject['color'],string>={
 ink:'var(--chalk-main)',blue:'var(--chalk-blue)',teal:'var(--chalk-teal)',
 amber:'var(--chalk-accent)',red:'var(--chalk-warn)',
};

/** A hand-drawn rectangle: one path with a slight overshoot at every corner. */
function handBoxPath(x:number,y:number,w:number,h:number){
 const r=Math.min(6,w/5,h/4);
 return `M ${x} ${y+r} Q ${x} ${y} ${x+r} ${y} L ${x+w-r} ${y-1.2} Q ${x+w} ${y} ${x+w} ${y+r} L ${x+w+1.2} ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h} L ${x+r} ${y+h+1.2} Q ${x} ${y+h} ${x} ${y+h-r} Z`;
}

export default function TeachingAnnotation({pairs,frames}:{pairs:GlyphPair[];frames:Map<string,Frame>}){
 if(!pairs.length)return null;
 return <svg className="annotation-layer" aria-hidden="true">
  {pairs.map(({glyph,state})=>{
   const f=frames.get(glyph.id);
   if(!f)return null;
   const tone=TONE[glyph.color];
   // Normalised geometry becomes padding around the framed object.
   const g=glyph.geometry??{x:8,y:8,width:84,height:84};
   const padX=Math.max(4,(g.x/100)*f.width*0.35);
   const padY=Math.max(3,(g.y/100)*f.height*0.5);
   const x=f.left-padX,y=f.top-padY,w=f.width+padX*2,h=f.height+padY*2;
   const cls=`annotation glyph-${glyph.type} state-${state}`;
   if(glyph.type==='draw_rectangle')
    return <path key={glyph.id} className={`${cls} handBox`} d={handBoxPath(x,y,w,h)} pathLength={1} stroke={tone} fill="none"/>;
   if(glyph.type==='draw_circle')
    return <ellipse key={glyph.id} className={`${cls} handBox`} cx={x+w/2} cy={y+h/2} rx={w/2+3} ry={h/2+3} pathLength={1} stroke={tone} fill="none"/>;
   if(glyph.type==='draw_line'){
    // A stroke under the object underlines it, and across the middle strikes it.
    const through=g.height<=2;
    const sy=through?y+h/2:y+h+3;
    return <path key={glyph.id} className={`${cls} handStroke`} d={`M ${x-4} ${sy} C ${x+w*0.33} ${sy+(through?1.2:-1.6)}, ${x+w*0.67} ${sy-(through?1.2:-1.6)}, ${x+w+4} ${sy}`} pathLength={1} stroke={tone} fill="none"/>;
   }
   if(glyph.type==='draw_arrow')
    return <g key={glyph.id} className={cls}><path className="handStroke" d={`M ${x} ${y+h/2} L ${x+w-9} ${y+h/2}`} pathLength={1} stroke={tone} fill="none"/><path className="handArrowHead" d={`M ${x+w-10} ${y+h/2-4.4} L ${x+w} ${y+h/2} L ${x+w-10} ${y+h/2+4.4}`} stroke={tone} fill="none" strokeLinecap="round" strokeLinejoin="round"/></g>;
   return null;
  })}
 </svg>;
}

export const isGlyph=(o:BoardObject)=>isAnnotation(o)&&o.type!=='erase_object'&&o.type!=='clear_region'&&o.type!=='clear_board'&&o.type!=='wait'&&o.type!=='unhighlight'&&o.type!=='change_emphasis'&&o.type!=='move_object'&&o.type!=='group_objects';
