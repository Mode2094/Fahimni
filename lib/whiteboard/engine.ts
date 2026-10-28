import { Action, BoardState, emptyBoard } from '../../schemas/lesson';
export const draws=new Set<Action['type']>(['write_text','write_latex','draw_line','draw_arrow','draw_circle','draw_rectangle','draw_axes','plot_point','plot_points','plot_graph','show_label','show_image','show_book_reference']);
export function applyAction(board:BoardState,a:Action):BoardState {
 if(a.type==='clear_board')return emptyBoard();
 let objects=board.objects.map(o=>({...o}));
 if(draws.has(a.type)){
  if(!a.id)throw new Error('Drawing requires id');
  const obj={id:a.id,type:a.type,content:a.content||'',region:a.region,points:a.points,geometry:a.geometry,color:a.color,highlighted:false,focused:false,group:null};
  objects=objects.filter(o=>o.id!==a.id);objects.push(obj);
 } else if(a.type==='clear_region') objects=objects.filter(o=>o.region!==a.region);
 else if(a.type==='erase_object')objects=objects.filter(o=>!a.targets.includes(o.id));
 else if(a.type!=='wait'){
  for(const target of a.targets)if(!objects.some(o=>o.id===target))throw new Error(`Unknown board object: ${target}`);
  if(a.type==='focus_object')objects.forEach(o=>o.focused=false);
  objects=objects.map(o=>a.targets.includes(o.id)?{...o,
   highlighted:a.type==='highlight'?true:a.type==='unhighlight'?false:o.highlighted,
   focused:a.type==='focus_object'?true:o.focused,
   color:a.type==='change_emphasis'?a.color:o.color,
   region:a.type==='move_object'?a.region:o.region,
   group:a.type==='group_objects'?a.id:o.group
  }:o);
 }
 if(objects.length>150)throw new Error('Board capacity exceeded');
 return {objects};
}
export function runActions(board:BoardState,actions:Action[]) {return actions.reduce(applyAction,board);}
export function beforeSegment(base:BoardState,segments:{actions:Action[]}[],index:number){return segments.slice(0,index).reduce((b,s)=>runActions(b,s.actions),base);}
export function validateActions(base:BoardState,segments:{actions:Action[]}[],allowedImages:string[]){
 let state=base;
 for(const s of segments)for(const a of s.actions){
  if(draws.has(a.type)&&!a.id)throw new Error('Missing object id');
  if(['write_latex','write_text','show_label'].includes(a.type)&&!a.content)throw new Error('Missing content');
  if(a.type==='show_image'&&!allowedImages.includes(a.content||''))throw new Error('Image outside retrieved sources');
  if(['plot_graph','plot_points','plot_point'].includes(a.type)&&!a.points.length)throw new Error('Missing plot points');
  if(['highlight','unhighlight','erase_object','focus_object','move_object','group_objects','change_emphasis'].includes(a.type)&&!a.targets.length)throw new Error('Missing target');
  state=applyAction(state,a);
 }
 return state;
}
