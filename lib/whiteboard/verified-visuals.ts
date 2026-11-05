import type {Action} from '../../schemas/lesson';
import {unitCircleFacts} from '../ai/visual-math-check';

export type VisualLibrary=Record<string,Action>;
const action=(value:Partial<Action>&{type:Action['type']}):Action=>({id:null,content:null,region:'graph-area',targets:[],points:[],geometry:null,color:'ink',delayMs:0,...value});
function ratioFraction(y:number,x:number){
 const decimalPlaces=(value:number)=>{const [mantissa,exponent='0']=String(value).split('e');return Math.max(0,(mantissa.split('.')[1]?.length??0)-Number(exponent));};
 const scale=10**Math.min(15,Math.max(decimalPlaces(y),decimalPlaces(x)));
 let numerator=Math.round(y*scale),denominator=Math.round(x*scale);
 const gcd=(a:number,b:number):number=>b?gcd(b,a%b):Math.abs(a);
 const divisor=gcd(numerator,denominator);numerator/=divisor;denominator/=divisor;
 const sign=numerator*denominator<0?'-':'';
 return Math.abs(denominator)===1?`${sign}${Math.abs(numerator)}`:`${sign}\\frac{${Math.abs(numerator)}}{${Math.abs(denominator)}}`;
}

/** Verified scene atoms are data, not executable model code. The tutor chooses
 * when to reveal a reference; the server owns its computed geometry/notation. */
export function verifiedVisualsFor(question:string):VisualLibrary{
 const facts=unitCircleFacts(question);if(!facts)return{};
 const library:VisualLibrary={
  axes:action({type:'draw_axes',color:'blue'}),
  circle:action({type:'draw_circle',points:[facts.center,{x:1,y:0}],color:'teal'}),
  identity:action({type:'write_latex',region:'working-area',content:'x^2+y^2=1'}),
  definition:action({type:'write_latex',region:'working-area',content:'P=(\\cos\\theta,\\sin\\theta)'}),
 };
 const p=facts.point;if(!p)return library;
 const math=(content:string,color:Action['color']='ink')=>action({type:'write_latex',region:'working-area',content,color});
 return {...library,
  point:action({type:'plot_point',points:[p],content:'P',color:'amber'}),
  radius:action({type:'draw_line',points:facts.radiusEndpoints,color:'amber'}),
  angle:action({type:'plot_points',points:facts.angleArcSamples,color:'amber'}),
  'angle-label':action({type:'show_label',points:[{x:.34*Math.cos(facts.thetaRadians/2),y:.34*Math.sin(facts.thetaRadians/2)}],content:'θ',color:'amber'}),
  'projection-x':action({type:'draw_line',points:facts.projections[0],color:'blue'}),
  'projection-y':action({type:'draw_line',points:facts.projections[1],color:'teal'}),
  coordinate:math(`P=(${p.x},${p.y})`),
  sin:math(`\\sin\\theta=y=${p.y}`,'teal'),
  cos:math(`\\cos\\theta=x=${p.x}`,'blue'),
  tan:p.x===0?math('\\tan\\theta\\;\\text{غير معرّف}') :math(`\\tan\\theta=\\frac{y}{x}=${ratioFraction(p.y,p.x)}`,'amber'),
  check:math(`(${p.x})^2+(${p.y})^2=1`,'teal'),
 };
}

export function resolveVisualReferences(actions:Action[],library:VisualLibrary):Action[]{
 return actions.map(a=>{
  if(a.type!=='use_visual'){
   if(Object.keys(library).length&&(a.type==='write_latex'||(a.region==='graph-area'&&['draw_axes','draw_circle','draw_line','draw_arrow','plot_point','plot_points','plot_graph','show_label'].includes(a.type))))throw new Error('Use use_visual with an available verifiedVisualRef for computed math and geometry; do not hand-copy coordinates or formulas');
   return a;
  }
  const key=a.content??'';const visual=library[key];
  if(!visual)throw new Error(`Unknown verified visual reference: ${key}`);
  return {...structuredClone(visual),id:a.id??`verified-${key}`,delayMs:a.delayMs};
 });
}
