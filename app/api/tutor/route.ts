import { z } from 'zod';
import { boardSchema } from '../../../schemas/lesson';
import { teach } from '../../../lib/ai/tutor';
import { guard,jsonBody,failure } from '../../../lib/http';
const schema=z.object({question:z.string().trim().min(2).max(4000),board:boardSchema,history:z.array(z.object({question:z.string().max(4000),title:z.string().max(100)})).max(8),currentStep:z.number().int().min(0).max(12),currentLesson:z.object({title:z.string().max(100),goals:z.array(z.string().max(150)).max(12),narrations:z.array(z.string().max(1300)).max(12)}).nullable()});
export async function POST(req:Request){try{guard(req);return Response.json(await teach(schema.parse(await jsonBody(req)),req.signal));}catch(e){return failure(e);}}
