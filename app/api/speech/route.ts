import { z } from 'zod';
import { provider } from '../../../lib/ai/provider';
import { guard,jsonBody,failure } from '../../../lib/http';
export async function POST(req:Request){try{guard(req);const {text}=z.object({text:z.string().min(1).max(1300)}).parse(await jsonBody(req,10000));const audio=await provider.speak(text,req.signal);return new Response(audio,{headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store'}});}catch(e){return failure(e);}}
