// Frontend-only presentation timing. The server schema stays untouched: these
// helpers schedule when an already-valid action becomes visible.
export const prefersReducedMotion=()=>
 typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Phase of a step, used to sequence focus → emphasis → annotation → result. */
export type StepPhase='focus'|'emphasize'|'annotate'|'transform'|'settle'|'conclude';

export interface ActionTiming{
 index:number;
 at:number; // ms into the step
 action:{type:string};
}

/**
 * Spread a segment's actions across its narration instead of firing them at the
 * start. Attention-setting actions (focus, highlight) lead; drawings and results
 * trail; the last action is guaranteed to land before the step ends.
 */
export function scheduleActions(count:number,durationMs:number,types:readonly string[]):ActionTiming[]{
 if(count<=0)return[];
 const reduced=prefersReducedMotion();
 const lead=['focus_object','focus','highlight','show_book_reference','wait'];
 const trail=['show_image','plot_graph','plot_points'];
 const span=reduced?0:Math.max(1200,durationMs*0.66);
 const base=count===1?span*0.5:span/(count-1);
 return types.map((type,i)=>{
  let at=base*i;
  if(!reduced){
   const weight=lead.includes(type)?0.7:trail.includes(type)?1.18:1;
   at*=weight;
   if(i>0&&lead.includes(type))at+=260; // Let the previous line register first.
  }
  return{index:i,at:Math.min(at,span),action:{type}};
 });
}

export const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
export const lerp=(a:number,b:number,t:number)=>a+(b-a)*clamp01(t);
/** Motion budget per teaching state, kept short and non-flashy. */
export const durationFor=(state:string)=>state==='entering'?340:state==='focused'?300:260;
export const easing='cubic-bezier(.2,.7,.2,1)';
