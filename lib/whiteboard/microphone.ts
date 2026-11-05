/** Browser permission prompts are not abortable. Bound the wait and release a
 * stream even when the browser grants permission after cancellation. */
export function requestMicrophone(signal:AbortSignal,timeoutMs=15000,getStream=()=>navigator.mediaDevices.getUserMedia({audio:true})):Promise<MediaStream>{
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error?:Error,stream?:MediaStream)=>{
   if(done){stream?.getTracks().forEach(track=>track.stop());return;}
   done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
   if(error)reject(error);else resolve(stream!);
  };
  const abort=()=>finish(new DOMException('Cancelled','AbortError'));
  const timer=setTimeout(()=>finish(new Error('لم يصل إذن الميكروفون. اسمح بالوصول من إعدادات المتصفح أو اكتب سؤالك.')),timeoutMs);
  if(signal.aborted){abort();return;}
  signal.addEventListener('abort',abort,{once:true});
  getStream().then(stream=>finish(undefined,stream),error=>finish(error));
 });
}
