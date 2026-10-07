import type {BoardObject,BoardState} from '../../schemas/lesson';
import type {TeachingVisualState} from './teaching-state';

// Teaching zones give the board a reading order instead of one uniform column:
// the question sits at the top, the live reasoning is held in the middle at the
// student's comfortable focal band, finished work recedes upward, and the answer
// gets its own deliberate moment at the bottom.
export type Zone='header'|'work'|'history'|'result';

export interface ZonePlan{
 zone:Zone;
 objects:BoardObject[];
}

const regionZone:Record<BoardObject['region'],Zone>={
 'top':'header',
 'working-area':'work',
 'graph-area':'work',
 'explanation-area':'work',
 'result-area':'result',
};

export const zoneOf=(o:BoardObject):Zone=>regionZone[o.region]??'work';

export interface LayoutInput{
 board:BoardState;
 states:Map<string,TeachingVisualState>;
 index:number;
 total:number;
}

const activeCount=(objects:BoardObject[],states:Map<string,TeachingVisualState>)=>
 objects.filter(o=>{const s=states.get(o.id);return s==='active'||s==='focused'||s==='highlighted'||s==='final';}).length;

/**
 * Partition the board into zones and decide which zone is currently the focus.
 * `work` wins when it is live; otherwise the board keeps the answer in view.
 */
export function planLayout({board,states,index,total}:LayoutInput){
 const byZone:Record<Zone,BoardObject[]>={header:[],work:[],history:[],result:[]};
 for(const o of board.objects)(byZone[zoneOf(o)]??byZone.work).push(o);
 const workLive=activeCount(byZone.work,states)>0;
 // The concluded answer takes the room once the lesson reaches it, so the
 // closing moment is never competing with the working line.
 const resultLive=byZone.result.length>0&&index>=total-1;
 const focus:Zone=resultLive?'result':workLive?'work':byZone.work.length?'work':'header';
 return{zones:Object.entries(byZone).map(([zone,objects])=>({zone:zone as Zone,objects})),focus};
}

/**
 * Logical rows for a zone: annotation glyphs attach to the maths they mark
 * rather than forming rows of their own. A glyph that arrives before its
 * content is buffered and adopted by the next row, so a box drawn around an
 * equation always wraps that equation instead of floating on an empty line.
 */
export function rowsFor(objects:BoardObject[]){
 const rows:BoardObject[][]=[];
 let pending:BoardObject[]=[];
 const flush=()=>{if(pending.length){rows[rows.length-1]?.push(...pending);pending=[];}};
 for(const o of objects){
  if(o.type==='draw_circle'||o.type==='draw_rectangle'||o.type==='draw_line'||o.type==='draw_arrow'){
   if(rows.length){rows[rows.length-1].push(o);continue;}
   pending.push(o);
   continue;
  }
  if(rows.length===0&&pending.length)rows.push(pending.splice(0));
  rows.push([o]);
 }
 flush();
 return rows;
}

/** How strongly a zone should read right now: 1 dominant, <1 receding. */
export function zoneWeight(zone:Zone,focus:Zone,hasFuture:boolean){
 if(zone===focus)return 1;
 if(zone==='result')return 0.72;
 if(zone==='history')return hasFuture?0.5:0.68;
 return 0.62;
}
