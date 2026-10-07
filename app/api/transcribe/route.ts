import { provider } from '../../../lib/ai/provider';
import { guard,upload,failure } from '../../../lib/http';
export async function POST(req:Request){try{guard(req);const f=await upload(req,'audio');return Response.json({question:await provider.transcribe(f,req.signal)});}catch(e){return failure(e);}}
