'use client';
import {useState} from 'react';
import {BookOpen,MoreHorizontal,Pause,Play,SkipBack,SkipForward,Volume2,VolumeX,X} from 'lucide-react';
import type {Lesson} from '../../schemas/lesson';
import type {PlaybackStatus} from '../../lib/whiteboard/usePlayback';

type Props={lesson:Lesson|null;index:number;status:PlaybackStatus;busy:boolean;voice:boolean;audioLoading:boolean;audioPlaying:boolean;audioError:string;toolsRef?:React.RefObject<HTMLButtonElement|null>;toolsOpen?:boolean;
 onToggle:()=>void;onJump:(index:number)=>void;onVoice:()=>void;onMore:()=>void;onBook:(page:number,bookId?:string|null)=>void};
export default function LessonConsole({toolsRef,...p}:Props){
 const [transcript,setTranscript]=useState(false);
 const current=p.lesson?.segments[p.index];
 const sound=p.audioError?'شرح مكتوب':p.audioLoading?'أجهّز الصوت…':p.audioPlaying?'المعلّم يتحدث':p.voice?'الصوت مفعّل':'الصوت مكتوم';
 return <div className="lesson-console">
  <div className="narration-bar"><div className="narration-copy"><span className="narrator-label">{current?.goal||'معلّمك، خطوة بخطوة'} <span className="teacher-state">{sound}</span></span><p aria-live="polite">{current?.narration||'اكتب سؤالك لنبدأ من الفكرة، ثم نحل معاً.'}</p></div><button className="icon-button" aria-label={p.voice?'كتم صوت المعلم':'تفعيل صوت المعلم'} onClick={p.onVoice}>{p.voice?<Volume2 size={19}/>:<VolumeX size={19}/>}</button></div>
  <div className="playback">
   <div className="playback-actions" dir="ltr">
    <button className="icon-button step-prev" disabled={!p.lesson||p.busy||p.index===0} aria-label="الخطوة السابقة" onClick={()=>p.onJump(p.index-1)}><SkipBack size={19}/></button>
    <button className="play-button" disabled={!p.lesson||p.busy} aria-label={p.status==='playing'?'إيقاف مؤقت':'تشغيل'} onClick={p.onToggle}>{p.status==='playing'?<Pause size={19}/>:<Play size={19}/>}</button>
    <button className="icon-button step-next" disabled={!p.lesson||p.busy||p.index===(p.lesson?.segments.length??0)-1} aria-label="الخطوة التالية" onClick={()=>p.onJump(p.index+1)}><SkipForward size={19}/></button>
   </div>
   <span className="step-time">{p.lesson?`الخطوة ${p.index+1} من ${p.lesson.segments.length}`:'نبدأ بسؤالك'}</span>
   {p.lesson&&<button className="transcript-button" onClick={()=>setTranscript(!transcript)} aria-expanded={transcript}>نص الشرح</button>}
   <button ref={toolsRef} className="icon-button tools-button" aria-label="أدوات الشرح" aria-expanded={p.toolsOpen??false} onClick={p.onMore}><MoreHorizontal size={22}/></button>
  </div>
  {transcript&&<section className="lesson-transcript" aria-label="نص الشرح الكامل"><div><strong>نص الشرح · صوت مولّد بالذكاء الاصطناعي</strong><button className="icon-button" aria-label="إغلاق نص الشرح" onClick={()=>setTranscript(false)}><X size={18}/></button></div>{p.lesson?.segments.map((segment,i)=><article key={segment.id} aria-current={p.index===i?'step':undefined}><button onClick={()=>p.onJump(i)}>{i+1}. {segment.goal}</button><p>{segment.narration}</p>{segment.sources.filter(s=>s.pdfPage>0).map(s=><button key={s.chunkId} onClick={()=>p.onBook(s.pdfPage,s.bookId)}><BookOpen size={14}/> صفحة {s.printedPage??s.pdfPage}</button>)}</article>)}</section>}
 </div>;
}
