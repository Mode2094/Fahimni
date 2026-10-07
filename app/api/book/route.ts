import {retrieve,sourceFor} from '../../../lib/textbook/retrieval';
export async function GET(req:Request){const q=new URL(req.url).searchParams.get('q')||'';return Response.json({results:retrieve(q.slice(0,800)).map(c=>({...sourceFor(c),excerpt:c.text.slice(0,350)}))});}
