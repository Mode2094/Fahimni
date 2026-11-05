import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertVisualMath,assertNarratedSigns} from '../lib/ai/visual-math-check';
import {unitCircleFixture} from '../lib/whiteboard/recovery-fixtures';
import type {Action,Lesson} from '../schemas/lesson';

test('a spoken quadrant claim cannot contradict the verified signs',()=>{
 assert.throws(()=>assertNarratedSigns('دائرة الوحدة P=(-0.6,0.8)',['في الربع التاني السالب بس جيب التمام.']),/sign/);
 assert.throws(()=>assertNarratedSigns('دائرة الوحدة P=(-0.6,0.8)',['جيب التمام موجب والظل سالب']),/sign/);
 assert.doesNotThrow(()=>assertNarratedSigns('دائرة الوحدة P=(-0.6,0.8)',['الجيب موجب، وجيب التمام سالب، والظل سالب لأنه موجب على سالب.']));
});

test('the actual provider output that moved P outside the unit circle is rejected',()=>{
 const observed=JSON.parse(readFileSync('docs/reviews/recovery/iterations/invalid-generated-geometry/unit-circle.json','utf8')) as Lesson;
 assert.throws(()=>assertVisualMath('اشرح دائرة الوحدة عند P=(-0.6,0.8)',{objects:[]},observed.segments),/semantic validation/);
});
test('the accurate staged reference lesson passes semantic verification',()=>{
 assert.doesNotThrow(()=>assertVisualMath('دائرة الوحدة P=(-0.6,0.8)',{objects:[]},unitCircleFixture.segments));
});
test('unit-circle constraints generalize to different given coordinates and quadrants',()=>{
 for(const point of [{x:.6,y:.8},{x:.6,y:-.8},{x:-.8,y:-.6}]){
  const theta=(Math.atan2(point.y,point.x)+2*Math.PI)%(2*Math.PI);
  const a=(type:Action['type'],id:string,points:Action['points']=[],content:string|null=null):Action=>({type,id,points,content,region:'graph-area',targets:[],color:'ink',geometry:null,delayMs:0});
  const actions=[a('draw_axes','axes'),a('draw_circle','circle',[{x:0,y:0},{x:1,y:0}]),a('plot_point','p',[point]),a('draw_line','r',[{x:0,y:0},point]),a('draw_line','px',[point,{x:point.x,y:0}]),a('draw_line','py',[point,{x:0,y:point.y}]),a('plot_points','arc',Array.from({length:33},(_,i)=>({x:.25*Math.cos(theta*i/32),y:.25*Math.sin(theta*i/32)}))),...(['sin','cos','tan'] as const).map((fn,i)=>({...a('write_latex',fn,[],`\\${fn}\\theta=${[point.y,point.x,point.y/point.x][i]}`),region:'working-area' as const}))];
  assert.doesNotThrow(()=>assertVisualMath(`دائرة الوحدة P=(${point.x},${point.y})`,{objects:[]},[{actions}]));
 }
});
test('a valid-looking but numerically wrong sine value is rejected',()=>{
 const copy=structuredClone(unitCircleFixture.segments);
 const sine=copy.flatMap(s=>s.actions).find(a=>a.id==='sin')!;sine.content=String.raw`\sin\theta=-0.8`;
 assert.throws(()=>assertVisualMath('دائرة الوحدة P=(-0.6,0.8)',{objects:[]},copy),/sin/);
});
