'use client';
import {useState,useRef,useEffect,useCallback} from 'react';
import {Lesson,BoardState,emptyBoard} from '../../schemas/lesson';
import {applyAction,beforeSegment} from './engine';
export type PlaybackStatus='idle'|'preparing'|'ready'|'playing'|'paused'|'completed'|'error';
// Intentional cancellation is normal control flow here: switching step, jumping,
// pausing and unmount all abort the in-flight speech fetch. That is not an error
// and must never reach an error boundary or surface as a runtime AbortError.
const isAbort=(e:unknown)=>e instanceof Error&&(e.name==='AbortError'||e.name==='TimeoutError');
export function usePlayback(){
 const [lesson,setLesson]=useState<Lesson|null>(null),[board,setBoard]=useState<BoardState>(emptyBoard),[index,setIndex]=useState(0),[status,setStatus]=useState<PlaybackStatus>('idle'),[revision,setRevision]=useState(0),[voice,setVoice]=useState(true),[rate,setRate]=useState(1),[audioError,setAudioError]=useState(''),[audioLoading,setAudioLoading]=useState(false);
 const base=useRef<BoardState>(emptyBoard()),audio=useRef<HTMLAudioElement|null>(null),active=useRef(false),speed=useRef(1),muted=useRef(false),cache=useRef(new Map<string,string>());
 // Exposed so the UI can read real playback progress for the voice indicator
 // without the hook depending on any view.
 const playerRef=useRef<HTMLAudioElement|null>(null);
 active.current=status==='playing';speed.current=rate;muted.current=!voice;
 useEffect(()=>{if(audio.current){audio.current.muted=!voice;audio.current.playbackRate=rate;}},[voice,rate]);
 useEffect(()=>{if(!audio.current)return;if(status==='playing')audio.current.play().catch(()=>setAudioError('اضغط تشغيل للسماح بالصوت في المتصفح.'));else audio.current.pause();},[status]);
 const halt=useCallback(()=>{active.current=false;audio.current?.pause();setStatus('paused');},[]);
 const load=useCallback((next:Lesson,current:BoardState)=>{audio.current?.pause();base.current=next.mode==='followup'?structuredClone(current):emptyBoard();setBoard(base.current);setLesson(next);setIndex(0);setAudioError('');setRevision(v=>v+1);setStatus('playing');},[]);
 useEffect(()=>{
  if(!lesson)return;const controller=new AbortController();let disposed=false;let player:HTMLAudioElement|null=null;let timer:ReturnType<typeof setInterval>|undefined;
  const segment=lesson.segments[index];if(!segment)return;
  setBoard(beforeSegment(base.current,lesson.segments,index));
  const alive=()=>!disposed&&!controller.signal.aborted;
  // Every state write is gated so an aborted run can never paint after teardown.
  const safe=(fn:()=>void)=>{if(alive())fn();};
  const run=async()=>{
   safe(()=>setAudioLoading(!muted.current));
   let duration=Math.max(4500,segment.narration.split(/\s+/).length*480),hasAudio=false;
   if(!muted.current){
    try{
     const key=lesson.id+':'+segment.id;let url=cache.current.get(key);
     if(!url){
      const r=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:segment.narration}),signal:controller.signal});
      if(!r.ok)throw new Error('speech');
      const blob=await r.blob();
      // Abort can land during blob(); drop the object URL instead of caching it.
      if(!alive())return;
      url=URL.createObjectURL(blob);
      cache.current.set(key,url);
      if(cache.current.size>24){const first=cache.current.keys().next().value!;const stale=cache.current.get(first)!;URL.revokeObjectURL(stale);cache.current.delete(first);}
     }
     if(!alive())return;
     player=new Audio(url);audio.current=player;playerRef.current=player;player.playbackRate=speed.current;player.muted=muted.current;
     await new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('audio timeout')),10000);
      const done=()=>{clearTimeout(timeout);resolve();};
      const fail=()=>{clearTimeout(timeout);reject(new Error('audio'));};
      player!.onloadedmetadata=done;player!.onerror=fail;player!.onended=done;player!.load();
     });
     if(!alive())return;duration=Math.max(3000,player.duration*1000);hasAudio=true;
     if(active.current)await player.play().catch(()=>{hasAudio=false;safe(()=>setAudioError('الصوت متوقف في المتصفح. اضغط إيقاف مؤقت ثم تشغيل لتفعيله.'));});
    }catch(e){
     if(!alive()||isAbort(e))return; // Cancellation: expected, stays silent.
     safe(()=>setAudioError('تعذر تشغيل الصوت. يمكنك متابعة الشرح المكتوب وإعادة الخطوة لاحقاً.'));
    }
   }
   if(!alive())return;
   safe(()=>setAudioLoading(false));
   let elapsed=0,actionIndex=0,last=performance.now();
   const actions=segment.actions;const delays=actions.map((a,i)=>i*Math.max(600,duration*.72/Math.max(1,actions.length))+a.delayMs);
   timer=setInterval(()=>{
    const now=performance.now();const delta=now-last;last=now;if(!alive()||!active.current)return;
    elapsed=hasAudio&&player&&!player.paused?player.currentTime*1000:elapsed+delta*speed.current;
    while(actionIndex<actions.length&&elapsed>=delays[actionIndex]){const a=actions[actionIndex++];setBoard(b=>applyAction(b,a));}
    if(actionIndex===actions.length&&elapsed>=duration){clearInterval(timer);player?.pause();if(!alive())return;if(index<lesson.segments.length-1)setIndex(i=>i+1);else setStatus('completed');}
   },40);
  };
  // run() owns its own cancellation paths; this is the final net so an abort can
  // never surface as an unhandled rejection.
  run().catch(e=>{if(!isAbort(e))console.error('[playback]',e);});
  return()=>{disposed=true;controller.abort();clearInterval(timer);player?.pause();if(audio.current===player)audio.current=null;if(playerRef.current===player)playerRef.current=null;};
 },[lesson,index,revision]);
 useEffect(()=>()=>{audio.current?.pause();cache.current.forEach(url=>URL.revokeObjectURL(url));},[]);
 const jump=(next:number)=>{if(!lesson)return;audio.current?.pause();setIndex(Math.max(0,Math.min(lesson.segments.length-1,next)));setRevision(v=>v+1);setStatus('playing');};
 const clear=()=>{audio.current?.pause();setLesson(null);setBoard(emptyBoard());base.current=emptyBoard();setStatus('idle');setIndex(0);setAudioError('');setAudioLoading(false);};
 return {lesson,board,index,status,setStatus,audioError,audioLoading,voice,setVoice,rate,setRate,load,halt,jump,clear,playerRef,toggle:()=>{if(status==='completed')jump(0);else setStatus(status==='playing'?'paused':'playing');},stop:()=>{halt();setStatus('ready');},restart:()=>jump(0)};
}
