import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actionSchema,type Action} from '../schemas/lesson';
import {verifiedVisualsFor,resolveVisualReferences} from '../lib/whiteboard/verified-visuals';
import {validateActions} from '../lib/whiteboard/engine';
import {assertVisualMath} from '../lib/ai/visual-math-check';

test('linear explanations include computed solution and substitution for different equations',()=>{
 for(const [question,solution] of [['حل 3x+6=18','x=4'],['حل 2x-3=8',String.raw`x=\frac{11}{2}`],['حل -x+2=5','x=-3'],[String.raw`حل \(3x+6=18\)`,'x=4'],['حل $3x+6=18$','x=4']]){
  const library=verifiedVisualsFor(question);
  assert.equal(library.solution?.content,solution);
  assert.ok(library.check?.content);
  assert.throws(()=>assertVisualMath(question,{objects:[]},[{actions:[{...ref('equation'),type:'write_latex',content:'3x+6=18'}]}]),/complete|solution/i);
  const actions=resolveVisualReferences(Object.keys(library).map(key=>ref(key)),library);
  assert.doesNotThrow(()=>assertVisualMath(question,{objects:[]},actions.map(a=>({actions:[a]}))));
 }
 assert.deepEqual(verifiedVisualsFor('حل x^2+3x=5'),{});
 assert.deepEqual(verifiedVisualsFor('حل 2x+3=5x'),{});
});

const ref=(content:string):Action=>({type:'use_visual',id:`ref-${content}`,content,region:'graph-area',targets:[],points:[],geometry:null,color:'ink',delayMs:0});
test('AI-selected references compile to verified geometry and canonical notation for different points',()=>{
 for(const tuple of ['(-0.6,0.8)','(0.6,-0.8)','(-0.8,-0.6)']){
  const question=`اشرح دائرة الوحدة P=${tuple}`;
  const library=verifiedVisualsFor(question);
  const actions=resolveVisualReferences(Object.keys(library).map(key=>ref(key)),library);
  for(const a of actions)assert.equal(actionSchema.safeParse(a).success,true);
  assert.doesNotThrow(()=>validateActions({objects:[]},[{actions}],[]));
  assert.doesNotThrow(()=>assertVisualMath(question,{objects:[]},[{actions}]));
  assert.equal(actions.some(a=>a.type==='use_visual'),false);
 }
});
test('unapproved references and hand-copied geometry cannot override a verified scene',()=>{
 const library=verifiedVisualsFor('دائرة الوحدة P=(-0.6,0.8)');
 assert.throws(()=>resolveVisualReferences([ref('invented')],library),/Unknown/);
 assert.throws(()=>resolveVisualReferences([{...ref('point'),type:'plot_point',points:[{x:-6,y:8}]}],library),/do not hand-copy/);
 const action=resolveVisualReferences([{...ref('point'),points:[{x:-6,y:8}]}],library)[0];
 assert.deepEqual(action.points,[{x:-.6,y:.8}]);
 assert.throws(()=>validateActions({objects:[]},[{actions:[ref('point')]}],[]),/resolved on the server/);
});
