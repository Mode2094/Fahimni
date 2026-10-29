import { z } from 'zod';
import { provider,ProviderError } from '../../../lib/ai/provider';
import { guard,uploadForm,failure } from '../../../lib/http';
import { aiFailureResponse, aiResponseHeaders, authorizeAiRequest, chargeAiCredits, refundAiCredits } from '../../../lib/ai/access';
import { CREDIT_COSTS } from '../../../lib/credits/config';
// Development-only trace. Records reachability and upstream status for the
// vision call without the key, the Authorization header, or image bytes.
const trace=(event:Record<string,unknown>)=>{if(process.env.NODE_ENV!=='production')console.error('[vision:trace]',JSON.stringify(event));};
const model=()=>process.env.OPENAI_VISION_MODEL||'gpt-4.1-mini';
export async function POST(req:Request){
 try{
  guard(req);
  const {file:f,fields}=await uploadForm(req,'image');
  const access=await authorizeAiRequest(req,{operation:'vision',subjectSlug:fields.subjectSlug??null});
  if(!access.ok)return aiFailureResponse(access.failure);
  const charge=await chargeAiCredits(access.context,{operation:'vision',credits:CREDIT_COSTS.vision,requestId:fields.requestId});
  if(!charge.ok)return aiFailureResponse(charge.failure,access.context);
  try{
   trace({stage:'guard',guardPassed:true,visionModel:model()});
   trace({stage:'upload',mime:f.type,bytes:f.size});
   const url=`data:${f.type};base64,${Buffer.from(await f.arrayBuffer()).toString('base64')}`;
   const result=z.object({clear:z.boolean(),question:z.string().min(1).max(4000)}).parse(await provider.vision(url,req.signal));
   trace({stage:'openai-reached',openaiStatus:200,clear:result.clear});
   if(!result.clear)throw new ProviderError('unclear',422);
   return Response.json({...result,credits:{balance:charge.balance}},{headers:aiResponseHeaders(access.context)});
  }catch(e){
   await refundAiCredits(charge);
   throw e;
  }
 }catch(e){trace({stage:'failed',code:e instanceof ProviderError?e.code:'invalid_request'});return failure(e);}
}
