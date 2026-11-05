import type {Action,BoardState} from '../../schemas/lesson';
import {circleFromPoints} from '../whiteboard/scene';
import {runActions} from '../whiteboard/engine';
import {evaluateNumeric} from './math-check';

const close=(a:number,b:number)=>Math.abs(a-b)<.005;
const same=(a:{x:number;y:number},b:{x:number;y:number})=>close(a.x,b.x)&&close(a.y,b.y);
const origin={x:0,y:0};
export function unitCircleFacts(question:string){
 if(!/دائرة\s*الوحدة/.test(question))return null;
 const normalized=question.replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[−–]/g,'-').replace(/٫/g,'.').replace(/،/g,',');
 const match=/\(\s*([+-]?(?:\d*\.)?\d+)\s*,\s*([+-]?(?:\d*\.)?\d+)\s*\)/.exec(normalized);
 const point=match?{x:Number(match[1]),y:Number(match[2])}:null;
 if(point&&Math.abs(point.x*point.x+point.y*point.y-1)>1e-8)return null;
 const theta=point?(Math.atan2(point.y,point.x)+2*Math.PI)%(2*Math.PI):0;
 return {center:origin,radius:1,point,thetaRadians:theta,
  radiusEndpoints:point?[origin,point]:[],
  projections:point?[[point,{x:point.x,y:0}],[point,{x:0,y:point.y}]]:[],
  angleArcSamples:point?Array.from({length:33},(_,i)=>({x:Number((.25*Math.cos(theta*i/32)).toFixed(4)),y:Number((.25*Math.sin(theta*i/32)).toFixed(4))})):[],
  ratios:point?{sin:point.y,cos:point.x,tan:point.x===0?null:point.y/point.x}:null,
 };
}
function numericLatex(text:string):number|null{
 const expression=text.replace(/\\frac\{([+-]?[\d.]+)\}\{([+-]?[\d.]+)\}/g,'(($1)/($2))').replace(/\\(?:left|right|quad|qquad)|\\[,;!]/g,'').trim();
 return evaluateNumeric(expression);
}

/** A mathematical acceptance contract, separate from schema/render validity.
 * Applies to an explanation of the unit circle with any explicitly supplied
 * on-circle coordinate. Other questions and coaching/quiz turns stay generic. */
export function assertVisualMath(question:string,base:BoardState,segments:{actions:Action[]}[]):void{
 const facts=unitCircleFacts(question);if(!facts)return;
 const {point}=facts;
 const objects=segments.reduce((board,s)=>runActions(board,s.actions),base).objects;
 const scene=objects.filter(o=>o.region==='graph-area');
 const errors:string[]=[];
 if(!scene.some(o=>o.type==='draw_axes'))errors.push('Keep draw_axes visible');
 if(!scene.some(o=>o.type==='draw_circle'&&(()=>{const c=circleFromPoints(o.points);return c&&same(c.center,origin)&&close(c.radius,1);})()))errors.push('draw_circle must be centered at (0,0) with radius1');
 if(point){
  if(!scene.some(o=>o.type==='plot_point'&&o.points[0]&&same(o.points[0],point)))errors.push(`Use plot_point at the GIVEN P=(${point.x},${point.y}), never alter the coordinates`);
  const hasLine=(a:typeof point,b:typeof point)=>scene.some(o=>['draw_line','draw_arrow','plot_points'].includes(o.type)&&o.points.length===2&&((same(o.points[0],a)&&same(o.points[1],b))||(same(o.points[1],a)&&same(o.points[0],b))));
  if(!hasLine(origin,point))errors.push('Draw the radius from origin to the exact given P');
  if(!hasLine(point,{x:point.x,y:0})||!hasLine(point,{x:0,y:point.y}))errors.push('Draw both coordinate projection segments from the exact P to the axes');
  const theta=(Math.atan2(point.y,point.x)+2*Math.PI)%(2*Math.PI);
  const hasArc=scene.some(o=>{
   if(o.type!=='plot_points'||o.points.length<3)return false;
   const r=Math.hypot(o.points[0].x,o.points[0].y);if(r<.1||r>.45)return false;
   if(!same(o.points[0],{x:r,y:0})||!same(o.points.at(-1)!,{x:r*point.x,y:r*point.y}))return false;
   let previous=0;
   for(const p of o.points){if(Math.abs(Math.hypot(p.x,p.y)-r)>.008)return false;const angle=(Math.atan2(p.y,p.x)+2*Math.PI)%(2*Math.PI);if(angle+0.02<previous||angle-previous>Math.PI/9)return false;previous=angle;}
   return Math.abs(previous-theta)<.03;
  });
  if(!hasArc)errors.push(`Show a small, smooth angle arc: plot_points at radius0.25 from angle0 to atan2(${point.y},${point.x}), with at least16 ordered samples; do not use the unit-circle circumference as the angle arc`);
  const formulas=objects.filter(o=>o.type==='write_latex').map(o=>o.content);
  for(const [fn,value] of [['sin',point.y],['cos',point.x],['tan',point.y/point.x]] as const){
   if(!Number.isFinite(value))continue;
   const matching=formulas.filter(f=>new RegExp(`\\\\${fn}(?![a-z])|\\b${fn}\\b`).test(f.split('=')[0]));
   if(!matching.length||matching.some(f=>{const rhs=f.split('=').at(-1)!;const actual=numericLatex(rhs);return actual===null||Math.abs(actual-value)>1e-8*Math.max(1,Math.abs(value));}))errors.push(`Display a separate canonical \\${fn}\\theta=${value} formula (fraction allowed), with a numerically correct final RHS`);
  }
 }
 if(errors.length)throw new Error(`Unit-circle semantic validation failed: ${errors.join('; ')}`);
}
