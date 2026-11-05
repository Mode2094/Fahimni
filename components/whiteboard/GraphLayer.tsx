'use client';
import type {Action,BoardObject} from '../../schemas/lesson';
import {circleFromPoints,sceneExtent,scenePath,worldToScene} from '../../lib/whiteboard/scene';
import {orderLine} from '../../lib/whiteboard/graph';

const TONE:Record<BoardObject['color'],string>={ink:'var(--chalk-main)',blue:'var(--chalk-blue)',teal:'var(--chalk-teal)',amber:'var(--chalk-accent)',red:'var(--chalk-warn)'};
const TYPES=new Set(['draw_axes','draw_circle','draw_rectangle','draw_line','draw_arrow','plot_point','plot_points','plot_graph','show_label']);

export default function GraphLayer({objects,planned=[],ghostIds,onSelect}:{objects:BoardObject[];planned?:Action[];ghostIds?:Set<string>;onSelect?:(object:BoardObject)=>void}){
 const plots=objects.filter(o=>TYPES.has(o.type));
 if(!plots.length)return null;
 const extent=sceneExtent([...objects,...planned]);
 const map=(p:{x:number;y:number})=>worldToScene(p,extent);
 const tick=extent<=2?1:extent<=6?2:5;
 const ticks:number[]=[];
 for(let value=-Math.floor(extent/tick)*tick;value<=extent;value+=tick)ticks.push(value);
 return <div className="graph-layer" dir="ltr" aria-label="رسم تفاعلي، اختر عنصراً للسؤال عنه">
  <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" data-world-extent={extent}>
   <g className="graph-grid" aria-hidden="true">{ticks.map(v=><g key={v}><line x1={map({x:v,y:0}).x} y1="10" x2={map({x:v,y:0}).x} y2="90"/><line x1="10" y1={map({x:0,y:v}).y} x2="90" y2={map({x:0,y:v}).y}/></g>)}</g>
   {plots.map(o=>{
    const cls=`graph-glyph graph-${o.type}${o.focused||o.highlighted?' is-focused':''}${ghostIds?.has(o.id)?' is-erasing':''}`;
    const stroke=TONE[o.color];
    let body:React.ReactNode=null;
    if(o.type==='draw_axes')body=<><path d="M 7 50 H 93 M 50 93 V 7" fill="none"/><text x="94" y="47">x</text><text x="53" y="7">y</text>{ticks.filter(v=>v!==0).map(v=><g key={v}><text className="graph-tick" x={map({x:v,y:0}).x} y="55">{v}</text><text className="graph-tick" x="46" y={map({x:0,y:v}).y+1}>{v}</text></g>)}</>;
    if(o.type==='draw_circle'){
     const circle=circleFromPoints(o.points);
     if(circle){const center=map(circle.center);body=<circle data-world-radius={circle.radius} cx={center.x} cy={center.y} r={circle.radius*40/extent} fill="none"/>;}
     else if(o.geometry){const g=o.geometry;body=<circle cx={g.x+g.width/2} cy={g.y+g.height/2} r={g.width/2} fill="none"/>;}
    }
    if(o.type==='draw_rectangle'&&o.geometry){const g=o.geometry;body=<rect x={g.x} y={g.y} width={g.width} height={g.height} fill="none"/>;}
    if(o.type==='plot_graph'||o.type==='plot_points'||o.type==='draw_line'||o.type==='draw_arrow'){
     const points=o.type==='plot_graph'?orderLine(o.points):o.points;
     body=<><path className="graph-stroke" d={scenePath(points,extent)} pathLength={1} fill="none"/>{o.type==='draw_arrow'&&points.length>=2&&(()=>{const end=map(points[1]),from=map(points[0]);const angle=Math.atan2(end.y-from.y,end.x-from.x);return <path d={`M ${end.x-4*Math.cos(angle-.45)} ${end.y-4*Math.sin(angle-.45)} L ${end.x} ${end.y} L ${end.x-4*Math.cos(angle+.45)} ${end.y-4*Math.sin(angle+.45)}`} fill="none"/>;})()}</>;
    }
    if(o.type==='plot_point'&&o.points[0]){const p=map(o.points[0]);body=<><circle cx={p.x} cy={p.y} r="1.2" fill={stroke}/>{o.content&&<text x={p.x+2} y={p.y-3}>{o.content}</text>}</>;}
    if(o.type==='show_label'&&o.points[0]){const p=map(o.points[0]);body=<text x={p.x} y={p.y}>{o.content}</text>;}
    if(!body)return null;
    return <g key={o.id} className={cls} data-object-id={o.id} stroke={stroke} strokeWidth="0.55" fill={stroke}
     role="button" tabIndex={0} aria-label={`اسأل عن ${o.content||o.id}`}
     onClick={()=>onSelect?.(o)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect?.(o);}}}>{body}</g>;
   })}
  </svg>
 </div>;
}
