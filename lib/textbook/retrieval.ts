import raw from '../../data/textbook.json';
export type Chunk=typeof raw[number];
export const chunks=raw as Chunk[];
export function normalize(s:string){return s.normalize('NFKC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u0640\u200e\u200f\u202a-\u202e]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).toLowerCase();}
const stop=new Set(['في','من','علي','الي','هو','هي','ما','كيف','اشرح','اشرحلي','لي','انا','هذا','هذه','حل','الدرس','اريد','بدي','ممكن','السؤال','اعطيني','ماهو']);
export function tokens(s:string){return normalize(s).split(/[^\p{L}\p{N}_^=+-]+/u).map(w=>w.replace(/^ال/,'')).filter(w=>w.length>1&&!stop.has(w));}
const synonyms:[RegExp,string][]=[[/دايره|دائرة|دائره|دائري/,'الدائرة الاقواس القطر نصف قطر'],[/مماس|اوتار|وتر /,'أوتار الدائرة وأقطارها ومماساتها'],[/جيب تمام|جيوب تمام|cosine|cos\b/,'جيوب التمام النسب المثلثية'],[/قانون.*جيب(?!.*تمام)|sine rule/,'قانون الجيوب'],[/sin\b|جيب |جا\b/,'النسب المثلثية جيب الزاوية'],[/مساح.*مثلث/,'استعمال جيب الزاوية لإيجاد مساحة المثلث'],[/شمال|bearing/,'الاتجاه من الشمال'],[/تكعيب|تكعيبيه|x\s*\^\s*[34]|عامل مشترك/,'حل معادلات خاصة التحليل'],[/نظام|معادلتين/,'نظام معادلة خطية تربيعية'],[/معادل|طرفين|اطرح|طرح|قسمة/,'المعادلات'],[/منحني|منحنى|رسم.*(جيب|مثلث)|دوري/,'تمثيل الاقترانات المثلثية']];
const docs=chunks.map(c=>({c,terms:tokens(c.text),title:tokens(c.lesson+' '+c.unit)}));
const df=new Map<string,number>();docs.forEach(d=>new Set(d.terms).forEach(t=>df.set(t,(df.get(t)||0)+1)));
const avg=docs.reduce((n,d)=>n+d.terms.length,0)/docs.length;
export function retrieve(question:string,limit=5){
 const original=normalize(question);const explicit=original.match(/(?:صفحه|page)\s*(\d{1,3})/);if(explicit){const page=Number(explicit[1]);const hit=chunks.find(c=>c.pdfPage===page);if(hit)return [hit,...chunks.filter(c=>c.lesson===hit.lesson&&c.pdfPage!==page).sort((a,b)=>Math.abs(a.pdfPage-page)-Math.abs(b.pdfPage-page)).slice(0,limit-1)].map(c=>({...c,score:100,matched:1}));}
 let q=original;if(/[=]/.test(q)&&!/[\u0600-\u06ff]/.test(q))q+=' المعادلات';const originalTerms=new Set(tokens(q));for(const [re,extra]of synonyms)if(re.test(q))q+=' '+normalize(extra);
 const terms=[...new Set(tokens(q))];if(!terms.length)return [];
 const ranked=docs.map(d=>{let score=original.includes(normalize(d.c.lesson))?25:0;let matched=0;for(const t of terms){const weight=originalTerms.has(t)?1:.3;const tf=d.terms.filter(w=>w===t).length;const title=d.title.includes(t);if(tf||title)matched++;if(tf)score+=weight*Math.log(1+(docs.length-(df.get(t)||0)+.5)/((df.get(t)||0)+.5))*tf*2.2/(tf+1.2*(.25+.75*d.terms.length/avg));if(title)score+=6*weight;}return {...d.c,score,matched};}).filter(c=>c.score>=3&&c.matched>=Math.min(2,terms.length)).sort((a,b)=>b.score-a.score);
 // Keep primary lesson coherent; spare one slot for an alternate match.
 const primary=ranked[0]?.lesson;
 return [...ranked.filter(x=>x.lesson===primary).slice(0,limit-1),...ranked.filter(x=>x.lesson!==primary).slice(0,1)].sort((a,b)=>b.score-a.score).slice(0,limit);
}
export function sourceFor(c:Chunk){return {chunkId:c.id,sourceId:c.sourceId,pdfPage:c.pdfPage,printedPage:c.printedPage,lesson:c.lesson,image:c.image};}
