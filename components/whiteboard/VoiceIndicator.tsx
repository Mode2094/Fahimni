'use client';
import {useEffect,useRef} from 'react';

// A few quiet bars rather than a futuristic equalizer. They react to real audio
// progress when a player is present, and idle gently when only text is teaching.
export default function VoiceIndicator({active,level,label}:{active:boolean;level:number;label?:string}){
 return <div className="voice-indicator" data-active={active} aria-hidden="true">
  <span className="voice-bars">{[0,1,2].map(i=><span key={i} style={{'--i':i,'--level':level} as React.CSSProperties}/>)}</span>
  {label&&<span className="voice-label">{label}</span>}
 </div>;
}

/** Drives VoiceIndicator level from a live element via requestAnimationFrame. */
export function useAudioLevel(player:React.RefObject<HTMLAudioElement|null>,active:boolean){
 const ref=useRef(0),bar=useRef(0);
 const frame=useRef(0);
 useEffect(()=>{
  if(!active){ref.current=0;return;}
  const el=player.current;
  const tick=()=>{
   const target=el&&!el.paused?0.55+0.45*Math.abs(Math.sin(el.currentTime*2.2)):0.18;
   ref.current+= (target-ref.current)*0.22;
   bar.current=ref.current;
   frame.current=requestAnimationFrame(tick);
  };
  frame.current=requestAnimationFrame(tick);
  return()=>cancelAnimationFrame(frame.current);
 },[active,player]);
 return bar;
}
