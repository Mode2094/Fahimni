'use client';
import {Check} from 'lucide-react';

// A lesson map, not an admin stepper: the board stays dominant, so the journey
// reads as a quiet spine of the lesson with generous space and no heavy chrome.
export default function LessonJourney({goals,index,total,status,busy,onJump,onSimpler,onWhyStep}:{
 goals:string[];index:number;total:number;status:string;busy:boolean;onJump:(i:number)=>void;onSimpler:()=>void;onWhyStep:()=>void;
}){
 if(!total)return <aside className="lesson-sidebar" data-empty="true"/>;
 // The numeric counters are LTR: in an RTL run "3 / 4" would otherwise read reversed.
 return <aside className="lesson-sidebar">
  <div className="sidebar-title"><span>رحلة الحل</span><span className="journey-progress" dir="ltr">{index+1} / {total}</span></div>
  <p className="sidebar-description">نفهم كل خطوة قبل أن ننتقل للتالية.</p>
  <ol className="steps">
   {goals.map((goal,i)=>{
    const state=i<index?'done':i===index?'active':'future';
    return <li key={i} data-state={state}>
     <button disabled={busy} aria-current={i===index?'step':undefined} onClick={()=>onJump(i)}>
      <span className="step-number">{i<index?<Check size={13}/>:<span>{String(i+1).padStart(2,'0')}</span>}</span>
      <span className="step-copy">{goal}</span>
      {i===index&&<span className="active-step" aria-hidden="true"/>}
     </button>
    </li>;
   })}
  </ol>
  <div className="followups">
   <span>خلّينا نتأكد أنك فهمت</span>
   <button disabled={busy} onClick={onSimpler}>اشرحها أبسط</button>
   <button disabled={busy} onClick={onWhyStep}>ليش هذه الخطوة؟</button>
  </div>
  {status==='completed'&&<div className="journey-done"><Check size={15}/><span>اكتملت الرحلة. اسأل أي خطوة تريد مراجعتها.</span></div>}
 </aside>;
}
