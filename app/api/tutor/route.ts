import { z } from 'zod';
import { boardSchema } from '../../../schemas/lesson';
import { teach } from '../../../lib/ai/tutor';
import { normalizeTeachingMode } from '../../../lib/ai/pedagogy';
import { guard,jsonBody,failure } from '../../../lib/http';
import { aiFailureResponse, aiResponseHeaders, authorizeAiRequest, chargeAiCredits, refundAiCredits } from '../../../lib/ai/access';
import { CREDIT_COSTS } from '../../../lib/credits/config';
import { booksStore } from '../../../lib/books/store';
import { learningProgressStore } from '../../../lib/learning/progress';
import { subjectRetriever } from '../../../lib/textbook/subject-retrieval';

const schema=z.object({question:z.string().trim().min(2).max(4000),board:boardSchema,history:z.array(z.object({question:z.string().max(4000),title:z.string().max(100)})).max(8),currentStep:z.number().int().min(0).max(12),currentLesson:z.object({title:z.string().max(100),goals:z.array(z.string().max(150)).max(12),narrations:z.array(z.string().max(1300)).max(12)}).nullable(),subjectSlug:z.string().trim().max(60).optional(),requestId:z.string().uuid().optional(),mode:z.enum(['explain','coach','quiz']).optional()});

export async function POST(req:Request){
 try{
  guard(req);
  const input=schema.parse(await jsonBody(req));
  // Full access guard: session → onboarding → subject → entitlement → device → rate limit.
  const access=await authorizeAiRequest(req,{operation:'tutor',subjectSlug:input.subjectSlug??null});
  if(!access.ok)return aiFailureResponse(access.failure);

  let retrieveFn;
  if(access.context.subject){
   const retriever=await subjectRetriever(access.context.subject.id,booksStore());
   if(!retriever)return aiFailureResponse({code:'book_required',status:422,message:'الكتاب غير جاهز بعد.'});
   retrieveFn=retriever;
  }

  // Personalization: weak or due topics for this student and subject only.
  let reviewTopics:string[]=[];
  if(access.context.user&&access.context.subject){
   try{
    const records=await learningProgressStore().listForUser(access.context.user.id);
    const now=Date.now();
    reviewTopics=records
     .filter(record=>record.subjectId===access.context.subject!.id&&(record.state==='NEEDS_PRACTICE'||(record.reviewDueAt?record.reviewDueAt.getTime()<=now:false)))
     .map(record=>record.topic);
   }catch{reviewTopics=[];}
  }

  // Reserve credits before any provider call; refund once on failure.
  const charge=await chargeAiCredits(access.context,{operation:'tutor',credits:CREDIT_COSTS.tutor,requestId:input.requestId});
  if(!charge.ok)return aiFailureResponse(charge.failure,access.context);

  try{
   const lesson=await teach({...input,mode:normalizeTeachingMode(input.mode),subjectSlug:access.context.subject?.slug??null,subjectName:access.context.subject?.name??null,reviewTopics},req.signal,undefined,retrieveFn);
   // Real assessment evidence only; failures never block the lesson response.
   if(lesson.assessment&&access.context.user&&access.context.subject){
    try{await learningProgressStore().recordAssessment({userId:access.context.user.id,subjectId:access.context.subject.id,assessment:lesson.assessment});}
    catch{console.warn('[learning] progress write failed');}
   }
   return Response.json({...lesson,credits:{balance:charge.balance,resetAt:access.context.resetAt?.toISOString()??null}},{headers:aiResponseHeaders(access.context)});
  }catch(e){
   await refundAiCredits(charge);
   throw e;
  }
 }catch(e){return failure(e);}
}
