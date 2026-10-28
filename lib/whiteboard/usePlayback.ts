'use client';
import {useState,useRef,useEffect,useCallback} from 'react';
import {Lesson,BoardState,emptyBoard} from '../../schemas/lesson';
import {applyAction,beforeSegment} from './engine';
export type PlaybackStatus='idle'|'preparing'|'ready'|'playing'|'paused'|'completed'|'error';
// Intentional cancellation is normal control flow here: switching step, jumping,
// pausing and unmount all abort the in-flight speech fetch. That is not an error
// and must never reach an error boundary or surface as a runtime AbortError.
const isAbort=(e:unknown)=>e instanceof Error&&(e.name==='AbortError'||e.name==='TimeoutError');
const mark=(name:string)=>{if(process.env.NODE_ENV!=='production'){try{performance.mark(name);}catch{/* marks are diagnostic only */}}};
export function usePlayback(subjectSlug?:string){
 const [lesson,setLesson]=useState<Lesson|null>(null),[board,setBoard]=useState<BoardState>(emptyBoard),[index,setIndex]=useState(0),[status,setStatus]=useState<PlaybackStatus>('idle'),[revision,setRevision]=useState(0),[voice,setVoice]=useState(true),[rate,setRate]=useState(1),[audioError,setAudioError]=useState(''),[audioLoading,setAudioLoading]=useState(false);
 const base=useRef<BoardState>(emptyBoard()),audio=useRef<HTMLAudioElement|null>(null),active=useRef(false),speed=useRef(1),muted=useRef(false),cache=useRef(new Map<string,string>()),inflight=useRef(new Map<string,Promise<string>>());
 // Exposed so the UI can read real playback progress for the voice indicator
 // without the hook depending on any view.
 const playerRef=useRef<HTMLAudioElement|null>(null);
 active.current=status==='playing';speed.current=rate;muted.current=!voice;
 useEffect(()=>{if(audio.current){audio.current.muted=!voice;audio.current.playbackRate=rate;}},[voice,rate]);
 useEffect(()=>{if(!audio.current)return;if(status==='playing')audio.current.play().catch(()=>setAudioError('اضغط تشغيل للسماح بالصوت في المتصفح.'));else audio.current.pause();},[status]);
 const halt=useCallback(()=>{active.current=false;audio.current?.pause();setStatus('paused');},[]);
 // Speech is fetched once per lesson step and cached. The stable requestId
 // (lessonId:segmentId) makes retries and prefetches idempotent server-side, so
 // a step can never be charged twice.
 const ensureAudio=useCallback((key:string,text:string):Promise<string>=>{
  const cached=cache.current.get(key);if(cached)return Promise.resolve(cached);
  const running=inflight.current.get(key);if(running)return running;
  const promise=(async()=>{
   const r=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,subjectSlug,requestId:key})});
   if(!r.ok){let message='تعذر تشغيل الصوت. يمكنك متابعة الشرح المكتوب وإعادة الخطوة لاحقاً.';try{const data=await r.json() as {error?:string};if(data&&typeof data.error==='string')message=data.error;}catch{}throw new Error(message);}
   const blob=await r.blob();
   const url=URL.createObjectURL(blob);
   cache.current.set(key,url);
   if(cache.current.size>24){const first=cache.current.keys().next().value!;const stale=cache.current.get(first)!;URL.revokeObjectURL(stale);cache.current.delete(first);}
   return url;
  })().finally(()=>inflight.current.delete(key));
  inflight.current.set(key,promise);
  return promise;
 },[subjectSlug]);
 const load=useCallback((next:Lesson,current:BoardState)=>{audio.current?.pause();base.current=next.mode==='followup'?structuredClone(current):emptyBoard();setBoard(base.current);setLesson(next);setIndex(0);setAudioError('');setRevision(v=>v+1);setStatus('playing');},[]);
 // Resume a suspended lesson at the exact step the student interrupted.
 const resume=useCallback((next:Lesson,at:number,current:BoardState)=>{audio.current?.pause();base.current=next.mode==='followup'?structuredClone(current):emptyBoard();setBoard(base.current);setLesson(next);setIndex(Math.max(0,Math.min(next.segments.length-1,at)));setAudioError('');setRevision(v=>v+1);setStatus('playing');},[]);
 // Prefetch the next step's audio while the current one plays, so narrated
 // steps follow each other without a TTS round-trip gap.
 useEffect(()=>{
  if(!lesson||muted.current)return;
  const next=lesson.segments[index+1];if(!next)return;
  const key=lesson.id+':'+next.id;
  if(cache.current.has(key))return;
  ensureAudio(key,next.narration).catch(()=>undefined);
 },[lesson,index,ensureAudio]);
 useEffect(()=>{
  if(!lesson)return;const controller=new AbortController();let disposed=false;let player:HTMLAudioElement|null=null;let timer:ReturnType<typeof setInterval>|undefined;
  const segment=lesson.segments[index];if(!segment)return;
  setBoard(beforeSegment(base.current,lesson.segments,index));
  const alive=()=>!disposed&&!controller.signal.aborted;
  // Every state write is gated so an aborted run can never paint after teardown.
  const safe=(fn:()=>void)=>{if(alive())fn();};
  const run=async()=>{
   safe(()=>setAudioLoading(!muted.current));
   mark('seg:start:'+segment.id);
   const words=segment.narration.split(/\s+/).length;
   // Board pacing starts immediately from a reading-speed estimate; audio is
   // loaded in parallel and never blocks the first visible step.
   let duration=Math.max(3500,words*380);
   let actionIndex=0,elapsed=0,last=performance.now(),audioEnded=false,audioFailed=false,hasAudio=false,firstAction=false;
   const actions=segment.actions;
   const schedule=()=>actions.map((a,i)=>i*Math.max(600,duration*.72/Math.max(1,actions.length))+a.delayMs);
   let delays=schedule();
   timer=setInterval(()=>{
    const now=performance.now();const delta=now-last;last=now;if(!alive()||!active.current)return;
    if(hasAudio&&player&&!player.paused)elapsed=player.currentTime*1000;else elapsed+=delta*speed.current;
    while(actionIndex<actions.length&&elapsed>=delays[actionIndex]){const a=actions[actionIndex++];setBoard(b=>applyAction(b,a));if(!firstAction){firstAction=true;mark('seg:first-action:'+segment.id);}}
    const actionsDone=actionIndex>=actions.length;
    const speechDone=!hasAudio||muted.current||audioFailed||audioEnded;
    if(actionsDone&&speechDone&&elapsed>=duration){
     clearInterval(timer);player?.pause();mark('seg:end:'+segment.id);
     if(!alive())return;
     if(index<lesson.segments.length-1)setIndex(i=>i+1);else setStatus('completed');
    }
   },40);
   if(muted.current){safe(()=>setAudioLoading(false));return;}
   try{
    const key=lesson.id+':'+segment.id;
    mark('seg:audio-fetch-start:'+segment.id);
    const url=await ensureAudio(key,segment.narration);
    if(!alive())return;
    mark('seg:audio-ready:'+segment.id);
    player=new Audio(url);audio.current=player;playerRef.current=player;player.playbackRate=speed.current;player.muted=muted.current;
    player.onended=()=>{audioEnded=true;mark('seg:audio-ended:'+segment.id);};
    await new Promise<void>((resolve,reject)=>{
     const timeout=setTimeout(()=>reject(new Error('audio timeout')),10000);
     const done=()=>{clearTimeout(timeout);resolve();};
     player!.onloadedmetadata=done;player!.onerror=()=>{clearTimeout(timeout);reject(new Error('audio'));};player!.load();
    });
    if(!alive())return;
    hasAudio=true;
    if(player.duration&&isFinite(player.duration)&&player.duration>0){duration=Math.max(duration,player.duration*1000);delays=schedule();}
    if(active.current)await player.play().then(()=>mark('seg:audio-play:'+segment.id)).catch(()=>{hasAudio=false;audioFailed=true;safe(()=>setAudioError('الصوت متوقف في المتصفح. اضغط إيقاف مؤقت ثم تشغيل لتفعيله.'));});
   }catch(e){
    if(!alive()||isAbort(e))return; // Cancellation: expected, stays silent.
    audioFailed=true;
    safe(()=>setAudioError(e instanceof Error&&e.message?e.message:'تعذر تشغيل الصوت. يمكنك متابعة الشرح المكتوب وإعادة الخطوة لاحقاً.'));
   }finally{safe(()=>setAudioLoading(false));}
  };
  // run() owns its own cancellation paths; this is the final net so an abort can
  // never surface as an unhandled rejection.
  run().catch(e=>{if(!isAbort(e))console.error('[playback]',e);});
  return()=>{disposed=true;controller.abort();clearInterval(timer);player?.pause();if(audio.current===player)audio.current=null;if(playerRef.current===player)playerRef.current=null;};
 },[lesson,index,revision,subjectSlug,ensureAudio]);
 useEffect(()=>()=>{audio.current?.pause();cache.current.forEach(url=>URL.revokeObjectURL(url));},[]);
 const jump=(next:number)=>{if(!lesson)return;audio.current?.pause();setIndex(Math.max(0,Math.min(lesson.segments.length-1,next)));setRevision(v=>v+1);setStatus('playing');};
 const clear=()=>{audio.current?.pause();setLesson(null);setBoard(emptyBoard());base.current=emptyBoard();setStatus('idle');setIndex(0);setAudioError('');setAudioLoading(false);};
 return {lesson,board,index,status,setStatus,audioError,audioLoading,voice,setVoice,rate,setRate,load,resume,halt,jump,clear,playerRef,toggle:()=>{if(status==='completed')jump(0);else setStatus(status==='playing'?'paused':'playing');},stop:()=>{halt();setStatus('ready');},restart:()=>jump(0)};
}
