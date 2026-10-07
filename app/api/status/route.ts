import {configured} from '../../../lib/ai/provider';
import manifest from '../../../data/manifest.json';
export async function GET(){return Response.json({configured:configured(),pages:manifest.totalPages,indexed:manifest.indexedPages,debug:process.env.NODE_ENV==='development'&&process.env.TUTOR_DIAGNOSTICS==='true'},{headers:{'Cache-Control':'no-store'}});}
