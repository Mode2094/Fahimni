import type { Action } from '../../schemas/lesson';
type Shape = Pick<Action, 'type'|'region'|'points'|'geometry'>;
export type Point = {x:number;y:number};

export function circleFromPoints(points: Point[]) {
  if(points.length!==2)return null;
  const [center,edge]=points;
  return {center,radius:Math.hypot(edge.x-center.x,edge.y-center.y)};
}

/** A square world viewport planned from the whole lesson prevents camera jumps. */
export function sceneExtent(shapes: Shape[]): number {
  let extent=1;
  for(const shape of shapes){
    if(shape.region!=='graph-area')continue;
    if(shape.type==='draw_circle'){
      const circle=circleFromPoints(shape.points);
      if(circle)extent=Math.max(extent,Math.abs(circle.center.x)+circle.radius,Math.abs(circle.center.y)+circle.radius);
      else if(shape.geometry)extent=10; // legacy normalized canvas, unchanged
    }
    for(const p of shape.points)extent=Math.max(extent,Math.abs(p.x),Math.abs(p.y));
  }
  return Math.min(10,extent*1.25);
}

export function worldToScene(point:Point,extent:number):Point {
  const scale=40/extent;
  return {x:50+point.x*scale,y:50-point.y*scale};
}

export function scenePath(points:Point[],extent:number):string {
  return points.map((point,i)=>{const p=worldToScene(point,extent);return `${i?'L':'M'} ${p.x} ${p.y}`;}).join(' ');
}
