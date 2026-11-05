import http from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
if(process.env.RECOVERY_PAID_VERIFICATION!=='authorized-up-to-5-usd')throw new Error('Explicit paid-verification opt-in required');
const env=parseEnv(readFileSync('.env.local','utf8'));
const base=env.OPENAI_BASE_URL?.replace(/\/$/,'')+'/';
if(new URL(base).origin!=='https://api.river.ai')throw new Error('This cost governor is priced for the HTTPS River origin only');
// Snapshot of the provider's public billing catalog, checked 2026-11-05.
const pricing={
 'zai-org/GLM-5.3-Flash':{input:.12,cachedInput:.024,output:.4},
 'deepseek-ai/DeepSeek-V4.1-Flash':{input:.12,cachedInput:.0024,output:.48},
 'nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4':{input:.07,cachedInput:.024,output:.37},
};
const file='.qa/provider-ledger.json';
let ledger={ceilingUsd:5,pricingSource:'https://docs.river.ai/guides/inference-models/',pricePerMillion:{input:.12,cachedInput:.024,output:.4},requests:[]};
try{ledger=JSON.parse(readFileSync(file,'utf8'));}catch{}
let reserved=0;
ledger.modelPricing=pricing;
const total=()=>ledger.requests.reduce((sum,r)=>sum+(r.estimatedCostUsd??r.upperBoundUsd),0);
const save=()=>writeFileSync(file,JSON.stringify({...ledger,totalEstimatedUsd:total(),generatedAt:new Date().toISOString()},null,2));
http.createServer(async(req,res)=>{
 try{
  const buffers=[];let bytes=0;
  for await(const part of req){bytes+=part.length;if(bytes>256000)throw new Error('body limit');buffers.push(part);}
  const body=Buffer.concat(buffers);const input=JSON.parse(body.toString('utf8'));
  // Only documented, explicitly priced text/vision models. Speech is blocked;
  // the existing credential is never forwarded to another provider.
  const model=input.model,rate=pricing[model];
  if(req.url!=='/chat/completions'||!rate){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'No supported, priced modality configured for this verification.'}}));return;}
  if(!Number.isInteger(input.max_completion_tokens)||input.max_completion_tokens<1||input.max_completion_tokens>6500){res.writeHead(400);res.end('{}');return;}
  const upperBound=(bytes+10000)*rate.input/1e6+input.max_completion_tokens*rate.output/1e6;
  if(total()+reserved+upperBound>5){res.writeHead(429);res.end('{}');return;}
  reserved+=upperBound;
  const record={startedAt:new Date().toISOString(),model,requestBytes:bytes,upperBoundUsd:upperBound};
  ledger.requests.push(record);save();
  try{
   const response=await fetch(base+'chat/completions',{method:'POST',headers:{Authorization:req.headers.authorization,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(90000)});
   const result=await response.text();record.status=response.status;if(response.ok)writeFileSync(`.qa/provider-response-${ledger.requests.indexOf(record)+1}.json`,result);
   try{
    const data=JSON.parse(result);const u=data.usage;
    if(u){record.usage=u;const cached=Math.min(u.prompt_tokens,u.prompt_tokens_details?.cached_tokens??0);record.estimatedCostUsd=((u.prompt_tokens-cached)*rate.input+cached*rate.cachedInput+u.completion_tokens*rate.output)/1e6;}
   }catch{}
   save();res.writeHead(response.status,{'Content-Type':'application/json'});res.end(result);
  }catch{record.transportError=true;save();res.writeHead(502);res.end('{}');}
  finally{reserved-=upperBound;}
 }catch{res.writeHead(400);res.end('{}');}
}).listen(3013,'127.0.0.1',()=>console.log('Local cost governor ready; absolute cumulative ceiling US$5'));
