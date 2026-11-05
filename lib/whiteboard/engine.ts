import { Action, BoardState, emptyBoard } from '../../schemas/lesson';
import { assertMathIntegrity, assertTextIntegrity } from '../ai/math-integrity';
export const draws=new Set<Action['type']>(['write_text','write_latex','draw_line','draw_arrow','draw_circle','draw_rectangle','draw_axes','plot_point','plot_points','plot_graph','show_label','show_image','show_book_reference']);
export function applyAction(board:BoardState,a:Action):BoardState {
 if(a.type==='use_visual')throw new Error('Verified visual reference must be resolved on the server');
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
 for(const object of base.objects){assertTextIntegrity(object.content);if(object.type==='write_latex')assertMathIntegrity(object.content);}
 let state=base;
 for(const s of segments)for(const a of s.actions){
  if(a.content)assertTextIntegrity(a.content);
  if(a.type==='write_latex')assertMathIntegrity(a.content||'');
  if(draws.has(a.type)&&!a.id)throw new Error('Missing object id');
  if(['write_latex','write_text','show_label'].includes(a.type)&&!a.content)throw new Error('Missing content');
  if(a.type==='show_image'&&!allowedImages.includes(a.content||''))throw new Error('Image outside retrieved sources');
  if(['plot_graph','plot_points','plot_point'].includes(a.type)&&!a.points.length)throw new Error('Missing plot points');
  if(['plot_graph','plot_points'].includes(a.type)&&a.points.length<2)throw new Error(`${a.type} ${a.id}: a curve needs at least two points; use plot_point for a single point, or provide the sampled curve coordinates`);
  if(a.type==='plot_point'&&a.points.length!==1)throw new Error('A plotted point needs exactly one coordinate');
  if(a.region==='graph-area'){
   if(['draw_line','draw_arrow'].includes(a.type)&&a.points.length!==2)throw new Error('Graph segments need two endpoints');
   if(a.type==='draw_circle'){
    if(a.points.length===2){
     const [center,edge]=a.points,r=Math.hypot(edge.x-center.x,edge.y-center.y);
     if(r<=0||Math.abs(center.x)+r>10||Math.abs(center.y)+r>10)throw new Error('Invalid world circle');
    }else if(!a.geometry||a.geometry.width<=0||a.geometry.width!==a.geometry.height||a.geometry.x+a.geometry.width>100||a.geometry.y+a.geometry.height>100)throw new Error('Circle needs center and radius point or square legacy geometry inside the canvas');
   }
  }
  if(['highlight','unhighlight','erase_object','focus_object','move_object','group_objects','change_emphasis'].includes(a.type)&&!a.targets.length)throw new Error('Missing target');
  state=applyAction(state,a);
 }
 return state;
}
