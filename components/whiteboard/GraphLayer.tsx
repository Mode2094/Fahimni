'use client';
import type {BoardObject} from '../../schemas/lesson';
import {
 axisTicks,
 arrowHeadPath,
 graphToSvg,
 orderLine,
 polylinePath,
 segmentPath,
 SVG_PAD,
 SVG_SIZE,
} from '../../lib/whiteboard/graph';

const TONE:Record<BoardObject['color'],string>={
 ink:'var(--chalk-main)',blue:'var(--chalk-blue)',teal:'var(--chalk-teal)',
 amber:'var(--chalk-accent)',red:'var(--chalk-warn)',
};

// Deterministic graph renderer: axes, lines, arrows and plotted points are all
// drawn from the validated [-10,10] coordinates in the lesson schema. No
// executable expressions, no AI-authored markup — geometry only.
export default function GraphLayer({objects,ghostIds}:{objects:BoardObject[];ghostIds?:Set<string>}){
 const plots=objects.filter(o=>['draw_axes','draw_line','draw_arrow','plot_point','plot_points','plot_graph'].includes(o.type));
 if(!plots.length)return null;
 const ticks=axisTicks(5);
 const origin=graphToSvg({x:0,y:0});
 return <div className="graph-layer" dir="ltr" role="img" aria-label="رسم بياني على السبورة">
  <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} preserveAspectRatio="xMidYMid meet">
   <g className="graph-grid" aria-hidden="true">
    {ticks.map((value)=>(
     <line key={`gx${value}`} x1={graphToSvg({x:value,y:0}).x} y1={SVG_PAD} x2={graphToSvg({x:value,y:0}).x} y2={SVG_SIZE-SVG_PAD} />
    ))}
    {ticks.map((value)=>(
     <line key={`gy${value}`} x1={SVG_PAD} y1={graphToSvg({x:0,y:value}).y} x2={SVG_SIZE-SVG_PAD} y2={graphToSvg({x:0,y:value}).y} />
    ))}
   </g>
   {plots.map((o)=>{
    const cls=`graph-glyph graph-${o.type}${ghostIds?.has(o.id)?' is-erasing':''}`;
    const stroke=TONE[o.color];
    if(o.type==='draw_axes'){
     return <g key={o.id} className={cls}>
      <line className="graph-stroke" x1={SVG_PAD} y1={origin.y} x2={SVG_SIZE-SVG_PAD} y2={origin.y} pathLength={1} stroke={stroke} />
      <line className="graph-stroke" x1={origin.x} y1={SVG_SIZE-SVG_PAD} x2={origin.x} y2={SVG_PAD} pathLength={1} stroke={stroke} />
      <text className="graph-axis-label" x={SVG_SIZE-SVG_PAD} y={origin.y-2}>x</text>
      <text className="graph-axis-label" x={origin.x+2} y={SVG_PAD+4}>y</text>
     </g>;
    }
    if(o.type==='plot_graph'){
     const d=polylinePath(orderLine(o.points));
     return d?<path key={o.id} className={`${cls} graph-stroke`} d={d} pathLength={1} stroke={stroke} fill="none" />:null;
    }
    if(o.type==='plot_points'){
     const d=polylinePath(o.points);
     return d?<path key={o.id} className={`${cls} graph-stroke`} d={d} pathLength={1} stroke={stroke} fill="none" />:null;
    }
    if(o.type==='plot_point'){
     const point=o.points[0];
     if(!point)return null;
     const svg=graphToSvg(point);
     return <circle key={o.id} className={`${cls} graph-dot`} cx={svg.x} cy={svg.y} r={1.8} stroke={stroke} fill={stroke} />;
    }
    if(o.type==='draw_line'&&o.points.length>=2){
     return <path key={o.id} className={`${cls} graph-stroke`} d={segmentPath(o.points[0],o.points[1])} pathLength={1} stroke={stroke} fill="none" />;
    }
    if(o.type==='draw_arrow'&&o.points.length>=2){
     return <g key={o.id} className={cls}>
      <path className="graph-stroke" d={segmentPath(o.points[0],o.points[1])} pathLength={1} stroke={stroke} fill="none" />
      <path className="graph-arrow-head" d={arrowHeadPath(o.points[0],o.points[1])} stroke={stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" />
     </g>;
    }
    return null;
   })}
  </svg>
 </div>;
}
