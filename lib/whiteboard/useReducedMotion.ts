'use client';
import {useEffect,useSyncExternalStore} from 'react';

const QUERY='(prefers-reduced-motion: reduce)';
const supported=()=>typeof window!=='undefined'&&typeof window.matchMedia==='function';

// matchMedia is an external store, so read it through useSyncExternalStore
// rather than mirroring it into state from an effect. The CSS alone already
// carries the visual result; the value exists for imperative behaviour such as
// auto-scroll and pointer placement.
function subscribe(onChange:()=>void){
 if(!supported())return()=>{};
 const mq=window.matchMedia(QUERY);
 mq.addEventListener('change',onChange);
 return()=>mq.removeEventListener('change',onChange);
}
const getSnapshot=()=>(supported()?window.matchMedia(QUERY).matches:false);
const getServerSnapshot=()=>false;

export function useReducedMotion(){
 const reduced=useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot);
 useEffect(()=>{
  if(typeof document==='undefined')return;
  document.documentElement.dataset.reducedMotion=reduced?'true':'false';
 },[reduced]);
 return reduced;
}
