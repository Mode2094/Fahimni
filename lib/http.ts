import { ProviderError } from './ai/provider';
const buckets=new Map<string,{count:number;until:number}>();
const isDev=()=>process.env.NODE_ENV!=='production';
// Header names only; no header value that could carry credentials is logged.
function logGuard(req:Request,computed:string[],allowed:boolean){
 if(!isDev())return;
 const h=req.headers;
 console.error('[guard:origin-check]',JSON.stringify({url:req.url,originHeader:h.get('origin'),computedOrigin:computed,host:h.get('host'),xForwardedHost:h.get('x-forwarded-host'),xForwardedProto:h.get('x-forwarded-proto'),allowed}));
}
// X-Forwarded-* may carry a comma separated chain; the client-facing hop is first.
const firstValue=(v:string|null)=>v?.split(',')[0]?.trim()||null;
const normalizeOrigin=(v:string|null)=>{if(!v)return null;try{const u=new URL(v);if(u.protocol!=='http:'&&u.protocol!=='https:')return null;return u.origin;}catch{return null;}};
// The origin the browser used, reconstructed from headers it cannot forge.
// `req.url` is rebuilt from the server's bind address, so on a host bound to
// 0.0.0.0 (next dev --hostname 0.0.0.0) it reports http://0.0.0.0:PORT and can
// never equal the page origin, which is why the Host header is used instead.
// Host is set by the browser to the target host, so matching Origin against it
// is the real CSRF gate. X-Forwarded-Host is deliberately NOT trusted for the
// decision: a client can forge it, which would let a caller pair any Origin
// with a matching forged header. Only the scheme is taken from the proxy, and
// the sibling http/https scheme is accepted for the same host so TLS-terminating
// proxies still match their own page origin.
function expectedOrigins(req:Request){
 const out=new Set<string>();
 const host=firstValue(req.headers.get('host'));
 if(!host)return[new URL(req.url).origin];
 const forwarded=firstValue(req.headers.get('x-forwarded-proto'));
 const own=new URL(req.url).protocol.replace(':','');
 const schemes=new Set([own,forwarded,'http','https'].filter((s):s is string=>Boolean(s)));
 for(const scheme of schemes){const o=normalizeOrigin(`${scheme}://${host}`);if(o)out.add(o);}
 return[...out];
}
export function sameOrigin(req:Request){
 if(!req.headers.get('origin'))return true; // Same-origin requests and non-browser clients omit Origin.
 const sent=normalizeOrigin(req.headers.get('origin'));
 if(!sent)return false; // "null" and non-http(s) origins are never same-origin.
 const computed=expectedOrigins(req);
 const allowed=computed.includes(sent);
 logGuard(req,computed,allowed);
 return allowed;
}
export function guard(req:Request){
 if(!sameOrigin(req))throw new ProviderError('forbidden',403);
 // Production AI rate limiting is Redis-backed per user (lib/rate-limit); the
 // in-memory IP bucket below is a development/test fallback only.
 if(process.env.NODE_ENV==='production')return;
 const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'local';const now=Date.now();
 if(buckets.size>2000)for(const [k,v] of buckets)if(v.until<now)buckets.delete(k);
 let b=buckets.get(ip);if(!b||b.until<now){b={count:0,until:now+60000};buckets.set(ip,b);}if(++b.count>90)throw new ProviderError('rate_limit',429);
}
export async function boundedBody(req:Request,max:number){
 if(Number(req.headers.get('content-length')||0)>max)throw new ProviderError('too_large',413);
 const reader=req.body?.getReader();if(!reader)return new Uint8Array();let size=0;const parts:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new ProviderError('too_large',413);}parts.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;
}
export async function jsonBody(req:Request,max=180000){return JSON.parse(new TextDecoder().decode(await boundedBody(req,max)));}
export async function uploadForm(req:Request,kind:'image'|'audio'){
 const max=kind==='image'?8*1024*1024:12*1024*1024;
 const bytes=await boundedBody(req,max+20000);const body=new Response(bytes.buffer as ArrayBuffer,{headers:{'Content-Type':req.headers.get('content-type')||''}});const form=await body.formData();const f=form.get('file');
 if(!(f instanceof File)||!f.size||f.size>max)throw new ProviderError('upload',400);
 const b=new Uint8Array(await f.arrayBuffer());const ascii=(start:number,end:number)=>String.fromCharCode(...b.slice(start,end));
 const type=f.type.split(';')[0];
 const valid=kind==='image'?
  ((type==='image/jpeg'&&b[0]===255&&b[1]===216&&b[2]===255&&/\.jpe?g$/i.test(f.name))||(type==='image/png'&&b[0]===137&&ascii(1,4)==='PNG'&&/\.png$/i.test(f.name))||(type==='image/webp'&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'&&/\.webp$/i.test(f.name))):
  ((['audio/webm','video/webm'].includes(type)&&b[0]===26&&b[1]===69&&b[2]===223&&b[3]===163)||(type==='audio/mp4'&&ascii(4,8)==='ftyp')||(type==='audio/ogg'&&ascii(0,4)==='OggS')||(['audio/wav','audio/x-wav'].includes(type)&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE')||(type==='audio/mpeg'&&(ascii(0,3)==='ID3'||b[0]===255)));
 if(!valid)throw new ProviderError('upload',400);
 const fields:Record<string,string>={};
 for(const [key,value] of form.entries())if(typeof value==='string')fields[key]=value;
 return {file:f,fields};
}
export async function upload(req:Request,kind:'image'|'audio'){return (await uploadForm(req,kind)).file;}
const messages:Record<string,string>={missing_key:'المعلّم غير متصل بعد. يلزم إعداد مفتاح خدمة الذكاء الاصطناعي لتفعيل الشرح والصوت.',no_context:'لم أجد معلومات كافية في الكتاب لهذا السؤال. حدّد الدرس أو أعد صياغة سؤالك.',upload:'الملف غير مدعوم أو غير صالح. استخدم صورة JPG أو PNG أو WebP واضحة، أو تسجيلاً صوتياً صالحاً.',too_large:'الملف كبير جداً. الحد الأقصى للصورة ٨ ميغابايت وللصوت ١٢ ميغابايت.',rate_limit:'طلبات كثيرة في وقت قصير. انتظر قليلاً ثم حاول مجدداً.',transcription:'لم أتمكن من فهم التسجيل. حاول مرة أخرى.',unclear:'الصورة غير واضحة بما يكفي. حاول تصوير السؤال بشكل أوضح.'};
export function failure(e:unknown){const code=e instanceof ProviderError?e.code:'invalid_request';if(process.env.NODE_ENV==='development')console.error('[tutor]',code,e instanceof Error?e.message:'');return Response.json({error:messages[code]||'تعذر تجهيز الشرح. حاول مرة أخرى.',code},{status:e instanceof ProviderError?e.status:400});}
