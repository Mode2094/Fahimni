import type {Action,Lesson,Source} from '../../schemas/lesson';

// Zero-cost visual development. Enabled with NEXT_PUBLIC_VISUAL_DEV_MODE=true
// and consumed only in the browser, so no server code path changes and real API
// mode is untouched when the flag is off.
const flag=process.env.NEXT_PUBLIC_VISUAL_DEV_MODE;
export const VISUAL_DEV_MODE=flag==='true'||flag==='1';

const a=(partial:Partial<Action> &{type:Action['type']}):Action=>({
 id:null,content:null,region:'working-area',targets:[],points:[],color:'ink',geometry:null,delayMs:0,...partial,
});

const src=(printedPage:number,pdfPage:number,lessonName:string,chunkId:string):Source=>({
 chunkId,sourceId:'unit-01',pdfPage,printedPage,lesson:lessonName,image:`/book/${pdfPage}.jpg`,
});

// A real lesson shape the app already supports: factoring a cubic by grouping,
// with two branches where one has no real solution. Six teaching segments with
// narration, LaTeX, highlights, arrows, focus and a concluded answer.
const segments=[
 {
  id:'step1',goal:'نكتب المعادلة كما وردت',narration:'عندنا المعادلة: تسعة x تربيع زائد ثمانية عشر x يساوي اثنين x زائد أربعة. المعادلة صفر الطرف الأيمن.',
  sourceChunkIds:['c-01'],actions:[
   a({id:'eq-original',type:'write_latex',content:'9x^3 + 18x^2 + 2x + 4 = 0',region:'top'}),
   a({id:'lbl-original',type:'show_label',content:'المعادلة الأصلية',region:'top'}),
  ]},
 {
  id:'step2',goal:'نبحث عن العامل المشترك',narration:'الحدان الأول والثاني فيهما عامل مشترك: تسعة x تربيع. والحدان الثالث والرابع فيهما: اثنين x. إذن نخرج العامل المشترك إكس.',
  sourceChunkIds:['c-01'],actions:[
   a({type:'focus_object',targets:['eq-original']}),
   a({id:'eq-factor-1',type:'write_latex',content:'x(9x^2 + 18) + 2(x + 2) = 0',region:'working-area'}),
   a({id:'box-a',type:'draw_rectangle',geometry:{x:2,y:4,width:96,height:92},region:'working-area',color:'amber'}),
   a({id:'lbl-gcd',type:'write_text',content:'العامل المشترك: x',region:'explanation-area'}),
  ]},
 {
  id:'step3',goal:'نحلل كل قوس على حدة',narration:'الآن نوزّع: إكس في تسعة x تربيع زائد ثمانية عشر، زائد اثنين في x زائد اثنين. نلاحظ أن القوسين يحتويان على نفسين: تسعة زائد ثمانية عشر، أي تسعة زائد تسعة عشرون.',
  sourceChunkIds:['c-01'],actions:[
   a({type:'highlight',targets:['eq-factor-1']}),
   a({id:'eq-factor-2',type:'write_latex',content:'x(9x^2 + 18) + 2(9x^2 + 18) = 0',region:'working-area'}),
   a({id:'box-9',type:'draw_rectangle',geometry:{x:20,y:4,width:60,height:92},region:'working-area',color:'amber'}),
  ]},
 {
  id:'step4',goal:'نحصل على معادلة من طرفين',narration:'نعامل تسعة x تربيع زائد ثمانية عشر كحد واحد. نطرحه من الطرفين فيبقى: اثنين مضروبة في تسعة x تربيع زائد ثمانية عشر يساوي صفر.',
  sourceChunkIds:['c-01'],actions:[
   a({type:'focus_object',targets:['eq-factor-2']}),
   a({id:'eq-reduce-1',type:'write_latex',content:'2(9x^2 + 18) = 0',region:'working-area'}),
  ]},
 {
  id:'step5',goal:'نقسم ونحل الجذر التربيعي',narration:'نقسم الطرفين على اثنين، فيبقى تسعة x تربيع زائد ثمانية عشر يساوي صفر. إذن تسعة x تربعي يساوي سالب ثمانية عشر. نأخذ الجذر التربيعي، فيكون ثلاثة x يساوي الجذر التربيعي لسالب ثمانية عشر، وهو عدد تخيلّي. إذن لا حل حقيقي على هذا الفرع.',
  sourceChunkIds:['c-01'],actions:[
   a({id:'eq-reduce-2',type:'write_latex',content:'9x^2 = -18',region:'working-area'}),
   a({id:'branch-negative',type:'show_label',content:'الفرع الأول · لا حل حقيقي',region:'explanation-area'}),
   a({id:'lbl-imaginary',type:'write_text',content:'الجذر التربيعي لـ ( -18 ) عدد تخيلّي',region:'explanation-area'}),
   a({id:'cross-negative',type:'draw_line',geometry:{x:0,y:86,width:100,height:0},region:'explanation-area',color:'red'}),
  ]},
 {
  id:'step6',goal:'نصل إلى الحل الحقيقي',narration:'نعود للفرع الثاني: تسعة x تربيع يساوي تسعة. نقسم على تسعة، فيكون x تربيع يساوي واحد. وبما أن المربع يساوي واحداً فإن x يساوي واحد أو سالب واحد. إذن الحل الحقيقي هو x يساوي واحد، أو x يساوي سالب واحد.',
  sourceChunkIds:['c-01'],actions:[
   a({type:'focus_object',targets:['eq-factor-2']}),
   a({id:'eq-positive',type:'write_latex',content:'9x^2 = 9',region:'working-area'}),
   a({id:'eq-square',type:'write_latex',content:'x^2 = 1',region:'working-area'}),
   a({id:'branch-valid',type:'show_label',content:'الفرع الثاني · حل حقيقي',region:'explanation-area'}),
   a({id:'eq-roots',type:'write_latex',content:'x = 1 \\quad\\text{أو}\\quad x = -1',region:'result-area',color:'amber'}),
   a({id:'box-final',type:'draw_rectangle',geometry:{x:3,y:8,width:94,height:84},region:'result-area',color:'amber'}),
   a({id:'lbl-final',type:'show_label',content:'إذن الحل الحقيقي',region:'result-area'}),
  ]},
];

// Spoken variants live beside the fixture: the server segment schema is
// untouched, and the board falls back to the written narration when absent.
const speech:Record<string,string>={
 step1:'عندنا المعادلة: تسعة إكس تربيع، زائد ثمانية عشر إكس، يساوي اثنين إكس، زائد أربعة. المعادلة صفر الطرف الأيمن.',
 step2:'الحدان الأول والثاني فيهما عامل مشترك: تسعة إكس تربيع. والحدان الثالث والرابع فيهما: اثنين إكس. إذن نخرج العامل المشترك إكس.',
 step3:'الآن نوزّع. نلاحظ أن القوسين يحتويان على تسعة، زائد ثمانية عشر. أي تسعة زائد تسعة عشرون.',
 step4:'نعامل تسعة إكس تربيع زائد ثمانية عشر كحد واحد. نطرحه من الطرفين. فيبقى: اثنين مضروبة في تسعة إكس تربيع، زائد ثمانية عشر، يساوي صفر.',
 step5:'نقسم الطرفين على اثنين. تسعة إكس تربيع يساوي سالب ثمانية عشر. نأخذ الجذر التربيعي. الجذر التربيعي لسالب ثمانية عشر عدد تخيلّي. إذن لا حل حقيقي على هذا الفرع.',
 step6:'نعود للفرع الثاني. تسعة إكس تربيع يساوي تسعة. نقسم على تسعة. إكس تربيع يساوي واحد. إذن إكس يساوي واحد، أو إكس يساوي سالب واحد. هذان هما الحلان.',
 fu1:'لأننا في الخطوة الثالثة جمعنا حدّين يحتويان على نفس التعبير. فصار عندنا حد مشترك نقدر نطرحه من الطرفين.',
};
export const fixtureSpeech=(segmentId:string)=>speech[segmentId];

const source=src(8,10,'حل المعادلات متعددة الحدود بالعامل المشترك','c-01');

export const fixtureLesson:Lesson={
 id:'visual-dev-fixture',
 question:'حل المعادلة 9x^3 + 18x^2 + 2x + 4 = 0',
 title:'تحليل المعادلة متعددة الحدود بالعامل المشترك',
 mode:'new',
 sufficientContext:true,
 message:'',
 segments:segments.map(s=>({...s,sources:[source]})),
 sources:[source],
};

export const fixtureFollowup:Lesson={
 ...fixtureLesson,
 id:'visual-dev-followup',
 question:'ليش عملنا هالخطوة؟',
 title:'لماذا نوزّع على القوسين؟',
 mode:'followup',
 segments:[
  {
   id:'fu1',goal:'نعود إلى الخطوة التي قسمنا عليها',narration:'لأننا في الخطوة الثالثة جمعنا حدّين يحتويان على تسعة، زائد ثمانية عشر. فصار عندنا حدّ مشترك نقدر نطرحه من الطرفين بدل ما نتعامل مع أربعة حدود.',
   sourceChunkIds:['c-01'],sources:[source],
   actions:[
    a({type:'focus_object',targets:['eq-factor-2']}),
    a({id:'fu-underline',type:'draw_line',geometry:{x:2,y:90,width:96,height:0},region:'working-area',color:'amber'}),
    a({id:'fu-note',type:'write_text',content:'الحد المشترك: تسعة x تربيع زائد ثمانية عشر',region:'explanation-area'}),
   ],
  },
 ],
};
