'use client';
import {useEffect,useState,startTransition} from 'react';
import Link from 'next/link';
import {lessonDraftKey,readLessonDraft} from '../../lib/whiteboard/session-draft';

export function ContinueLearning({userId,subjects}:{userId:string;subjects:{slug:string;name:string}[]}){
 const [drafts,setDrafts]=useState<{slug:string;name:string;title:string;step:number}[]>([]);
 useEffect(()=>{
  try{const next=subjects.flatMap(subject=>{const saved=readLessonDraft(sessionStorage.getItem(lessonDraftKey(userId,subject.slug)));return saved?[{...subject,title:saved.lesson.title,step:saved.index+1}]:[];});startTransition(()=>setDrafts(next));}catch{/* Storage may be disabled. */}
 },[userId,subjects]);
 return <section className="continue-learning" aria-label="تابع التعلّم"><span className="fn-eyebrow">خطوتك التالية</span><h2>{drafts.length?'نرجع للفكرة من حيث وقفنا':'ابدأ بفكرة واحدة اليوم'}</h2>{drafts.length?drafts.map(d=><Link key={d.slug} href={`/app/subjects/${d.slug}/tutor`} className="continue-learning__link"><span><strong>{d.title}</strong><small>{d.name} · الخطوة {d.step} · محفوظ في علامة التبويب هذه</small></span><span>تابع الدرس ←</span></Link>):<><p>اختر مادة جاهزة، واسأل عن خطوة لم تفهمها. تقدر توقف الشرح وتسأل في أي لحظة.</p><Link href="/app/subjects" className="fn-btn fn-btn--primary">اختر مادتي وابدأ</Link></>}</section>;
}
