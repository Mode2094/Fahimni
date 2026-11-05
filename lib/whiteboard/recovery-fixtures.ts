import type {Action,Lesson,Segment} from '../../schemas/lesson';
const a=(value:Partial<Action>&{type:Action['type']}):Action=>({id:null,content:null,region:'working-area',targets:[],points:[],color:'ink',geometry:null,delayMs:0,...value});
const graph=(value:Partial<Action>&{type:Action['type']})=>a({...value,region:'graph-area'});
function lesson(id:string,title:string,steps:{goal:string;narration:string;actions:Action[]}[]):Lesson{
 return {id,title:`عرض تجريبي — ${title}`,question:title,mode:'new',sufficientContext:true,message:'عرض تجريبي محلي، ليس إجابة مولدة من الكتاب.',assessment:null,sources:[],segments:steps.map((s,i):Segment=>({...s,id:`${id}-s${i}`,sourceChunkIds:['rendering-fixture'],sources:[]}))};
}
export const unitCircleFixture=lesson('unit-circle','دائرة الوحدة والنسب المثلثية',[
 {goal:'دائرة نصف قطرها واحد',narration:'دائرة الوحدة مركزها نقطة الأصل ونصف قطرها واحد. كل نقطة عليها تبعد وحدة واحدة عن المركز.',actions:[
  a({type:'write_text',id:'heading',region:'top',content:'دائرة الوحدة · نربط الإحداثيات بالزاوية'}),
  graph({type:'draw_axes',id:'axes',color:'blue'}),
  graph({type:'draw_circle',id:'circle',points:[{x:0,y:0},{x:1,y:0}],color:'teal'}),
  a({type:'write_latex',id:'definition',content:String.raw`x^2+y^2=1`}),
 ]},
 {goal:'نحدد النقطة والزاوية',narration:'النقطة بي إحداثيها السيني سالب ستة أعشار والصادي ثمانية أعشار. تقع في الربع الثاني؛ الزاوية تبدأ من المحور السيني الموجب وتصل إلى نصف القطر.',actions:[
  graph({type:'plot_point',id:'point-p',content:'P',points:[{x:-.6,y:.8}],color:'amber'}),
  graph({type:'draw_line',id:'radius',points:[{x:0,y:0},{x:-.6,y:.8}],color:'amber'}),
  graph({type:'plot_points',id:'angle',points:Array.from({length:41},(_,i)=>{const t=Math.acos(-.6)*i/40;return{x:.25*Math.cos(t),y:.25*Math.sin(t)};}),color:'amber'}),
  graph({type:'show_label',id:'angle-label',content:'θ',points:[{x:.18,y:.35}],color:'amber'}),
  a({type:'write_latex',id:'point-value',content:'P=(-0.6,0.8)'}),
  a({type:'write_latex',id:'verify',content:'(-0.6)^2+(0.8)^2=1',color:'teal'}),
 ]},
 {goal:'الجيب هو الإحداثي الصادي',narration:'نسقط النقطة على المحورين. الجيب هو الإحداثي الصادي، إذن جيب الزاوية ثمانية أعشار موجب لأن النقطة فوق المحور السيني.',actions:[
  graph({type:'draw_line',id:'projection-y',points:[{x:-.6,y:.8},{x:0,y:.8}],color:'teal'}),
  graph({type:'draw_line',id:'projection-x',points:[{x:-.6,y:0},{x:-.6,y:.8}],color:'blue'}),
  a({type:'write_latex',id:'sin',content:String.raw`\sin\theta=y=0.8`,color:'teal'}),
 ]},
 {goal:'جيب التمام هو الإحداثي السيني',narration:'جيب التمام يساوي الإحداثي السيني، أي سالب ستة أعشار. الإشارة سالبة لأن النقطة تقع يسار المحور الصادي.',actions:[
  a({type:'focus_object',targets:['projection-x']}),
  a({type:'write_latex',id:'cos',content:String.raw`\cos\theta=x=-0.6`,color:'blue'}),
 ]},
 {goal:'الظل ونراجع الإشارات',narration:'الظل هو الصادي مقسوماً على السيني، فيساوي سالب أربعة على ثلاثة. في الربع الثاني الجيب موجب وجيب التمام والظل سالبان. لماذا تتغير إشارة جيب التمام إذا انتقلنا إلى الربع الأول؟',actions:[
  a({type:'write_latex',id:'tan',content:String.raw`\tan\theta=\frac{y}{x}=-\frac{4}{3}`,color:'amber'}),
  a({type:'write_text',id:'signs',region:'result-area',content:'الربع الثاني: الجيب موجب، جيب التمام والظل سالبان.'}),
 ]},
]);
export const algebraFixture=lesson('algebra','نحل المعادلة ونتحقق من الحل',[
 {goal:'نقرأ المعادلة',narration:'نريد إيجاد قيمة إكس. نحافظ على تساوي الطرفين في كل خطوة.',actions:[a({type:'write_text',id:'algebra-title',region:'top',content:'نحل المعادلة مع الحفاظ على توازن الطرفين'}),a({type:'write_latex',id:'equation',content:'3x+6=18'})]},
 {goal:'نطرح ستة من الطرفين',narration:'نطرح ستة من كل طرف لنعزل الحد الذي يحتوي على إكس. ثمانية عشر ناقص ستة يساوي اثني عشر.',actions:[a({type:'write_latex',id:'subtract',content:'3x+6-6=18-6'}),a({type:'write_latex',id:'isolated',content:'3x=12'})]},
 {goal:'نقسم على ثلاثة',narration:'ثلاثة مضروبة في إكس تساوي اثني عشر، إذن نقسم الطرفين على ثلاثة فتصبح إكس أربعة.',actions:[a({type:'write_latex',id:'divide',content:String.raw`\frac{3x}{3}=\frac{12}{3}`}),a({type:'write_latex',id:'answer',region:'result-area',content:'x=4',color:'teal'})]},
 {goal:'نعوض للتحقق',narration:'نعوض بأربعة في المعادلة الأصلية. ثلاثة في أربعة زائد ستة يساوي ثمانية عشر، إذن الحل صحيح. جرب الآن حل معادلة مشابهة: ثلاثة إكس زائد ستة يساوي واحداً وعشرين.',actions:[a({type:'write_latex',id:'check',content:String.raw`3(4)+6=18\;\checkmark`,color:'teal'})]},
]);
