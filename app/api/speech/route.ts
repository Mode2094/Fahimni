import { z } from 'zod';
import { provider } from '../../../lib/ai/provider';
import { guard,jsonBody,failure } from '../../../lib/http';
import { applyAiHeaders, aiFailureResponse, authorizeAiRequest, chargeAiCredits, refundAiCredits } from '../../../lib/ai/access';
import { speechCredits } from '../../../lib/credits/config';
const schema=z.object({text:z.string().min(1).max(1300),subjectSlug:z.string().trim().max(60).optional(),requestId:z.string().max(120).optional()});
export async function POST(req:Request){
 try{
  guard(req);
  const {text,subjectSlug,requestId}=schema.parse(await jsonBody(req,10000));
  const access=await authorizeAiRequest(req,{operation:'speech',subjectSlug:subjectSlug??null});
  if(!access.ok)return aiFailureResponse(access.failure);
  // TTS cost scales with the generated text size (small minimum).
  const charge=await chargeAiCredits(access.context,{operation:'speech',credits:speechCredits(text),requestId});
  if(!charge.ok)return aiFailureResponse(charge.failure,access.context);
  try{
   const audio=await provider.speak(text,req.signal);
   const headers=applyAiHeaders(new Headers({'Content-Type':'audio/mpeg','Cache-Control':'no-store','X-Fahimni-Credits':String(charge.balance)}),access.context);
   return new Response(audio,{headers});
  }catch(e){
   await refundAiCredits(charge);
   throw e;
  }
 }catch(e){return failure(e);}
}
