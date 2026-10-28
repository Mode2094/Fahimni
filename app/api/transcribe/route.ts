import { provider } from '../../../lib/ai/provider';
import { guard,uploadForm,failure } from '../../../lib/http';
import { aiFailureResponse, aiResponseHeaders, authorizeAiRequest, chargeAiCredits, refundAiCredits } from '../../../lib/ai/access';
import { CREDIT_COSTS } from '../../../lib/credits/config';
export async function POST(req:Request){
 try{
  guard(req);
  const {file:f,fields}=await uploadForm(req,'audio');
  const access=await authorizeAiRequest(req,{operation:'transcription',subjectSlug:fields.subjectSlug??null});
  if(!access.ok)return aiFailureResponse(access.failure);
  const charge=await chargeAiCredits(access.context,{operation:'transcription',credits:CREDIT_COSTS.transcription,requestId:fields.requestId});
  if(!charge.ok)return aiFailureResponse(charge.failure,access.context);
  try{
   const question=await provider.transcribe(f,req.signal);
   return Response.json({question,credits:{balance:charge.balance}},{headers:aiResponseHeaders(access.context)});
  }catch(e){
   await refundAiCredits(charge);
   throw e;
  }
 }catch(e){return failure(e);}
}
