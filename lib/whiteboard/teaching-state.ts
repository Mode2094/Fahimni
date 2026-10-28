import type {Action,BoardObject,Lesson} from '../../schemas/lesson';

// A board object can be in one presentation state at a time. The board derives
// this from stable object IDs and the active segment, never from DOM position.
export type TeachingVisualState=
 |'inactive' // Present but the teacher has not reached it yet
 |'entering' // Just written; reveal animation in flight
 |'active' // Part of the current line of reasoning
 |'focused' // The teacher is explicitly pointing here
 |'highlighted' // Chalk emphasis applied
 |'completed' // Finished earlier step
 |'dimmed' // Completed and no longer relevant to the current step
 |'invalid' // Dead branch, e.g. no real solution
 |'important' // Carries the pedagogical point
 |'final'; // The concluded answer

export interface TeachingContext{
 objects:BoardObject[];
 index:number;
 segments:{actions:Action[]}[];
 status:string;
 // Objects the current segment's actions will touch, from actions already applied.
 activeIds:ReadonlySet<string>;
 focusedIds:ReadonlySet<string>;
 highlightedIds:ReadonlySet<string>;
 finalIds:ReadonlySet<string>;
}

// An annotation object (underline, bracket, arrow, cross) is one that decorates
// other objects rather than stating new mathematics.
const annotationTypes=new Set<BoardObject['type']>(['draw_line','draw_arrow','draw_circle','draw_rectangle','move_object','group_objects','erase_object','clear_region','clear_board','wait','unhighlight','change_emphasis']);
export const isAnnotation=(o:BoardObject)=>annotationTypes.has(o.type);
export const isMath=(o:BoardObject)=>o.type==='write_latex';

// Terminal states read better emphasised, and the live lesson keeps the answer
// at the bottom in result-area.
const finalTypes=new Set<BoardObject['type']>(['write_latex','write_text','show_label']);

/**
 * Decide the visual state of every object on the board.
 * Objects written by the active segment read as active/focused; everything from
 * earlier segments reads as completed and then dims unless it is still relevant
 * (referenced by the active segment) or holds the final answer.
 */
export function deriveTeachingStates(ctx:TeachingContext):Map<string,TeachingVisualState>{
 const{objects,index,segments,activeIds,focusedIds,highlightedIds,finalIds}=ctx;
 // Which objects did earlier segments already complete?
 const completed=new Set<string>();
 for(let i=0;i<index&&i<segments.length;i++)for(const a of segments[i].actions)if(a.id)completed.add(a.id);
 const states=new Map<string,TeachingVisualState>();
 for(const o of objects){
  if(finalIds.has(o.id)&&finalTypes.has(o.type)){states.set(o.id,'final');continue;}
  if(focusedIds.has(o.id)){states.set(o.id,'focused');continue;}
  if(o.focused){states.set(o.id,'focused');continue;}
  if(highlightedIds.has(o.id)||o.highlighted){states.set(o.id,activeIds.has(o.id)?'highlighted':'completed');continue;}
  if(activeIds.has(o.id)){states.set(o.id,'active');continue;}
  if(completed.has(o.id)){states.set(o.id,index>0&&o.region==='result-area'?'completed':'completed');continue;}
  states.set(o.id,completed.size?'completed':'inactive');
 }
 return states;
}

// Drawing glyphs carry the teaching emphasis too: a box drawn around the current
// line is part of the current step, not a leftover.
const DRAWS=new Set<Action['type']>(['draw_line','draw_arrow','draw_circle','draw_rectangle','show_image']);

/** Collect the object IDs the active segment acts on, from its own action list. */
export function idsForSegment(actions:Action[]){
 const active=new Set<string>(),focused=new Set<string>(),highlighted=new Set<string>(),final=new Set<string>();
 for(const a of actions){
  if(a.id&&(DRAWS.has(a.type)||['write_latex','write_text','show_label'].includes(a.type)))active.add(a.id);
  for(const t of a.targets){
   if(a.type==='highlight'||a.type==='unhighlight')highlighted.add(t);
   else if(a.type==='focus_object'||a.type==='move_object')focused.add(t);
   else active.add(t);
  }
  if(a.region==='result-area'&&a.id)final.add(a.id);
 }
 return{active,focused,highlighted,final};
}

/** The object the teacher pointer should rest on for the current step. */
export function pointerTarget(ctx:TeachingContext):string|null{
 const{objects,activeIds,focusedIds}=ctx;
 const focused=[...focusedIds].find(id=>objects.some(o=>o.id===id));
 if(focused)return focused;
 const active=objects.filter(o=>activeIds.has(o.id));
 if(!active.length)return null;
 // Prefer the most recently written active object: it is what was just discussed.
 return active[active.length-1].id;
}

/** Narration text for the current step, kept separate for the voice layer. */
export const speechNarration=(lesson:Lesson|null,index:number)=>{
 const s=lesson?.segments[index];
 if(!s)return'';
 const record=s as unknown as{speechNarration?:string};
 return record.speechNarration?.trim()||s.narration;
};
