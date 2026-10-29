import {aiConfigured} from '../../../lib/ai/runtime-config';
import manifest from '../../../data/manifest.json';
export async function GET(){return Response.json({configured:await aiConfigured(),pages:manifest.totalPages,indexed:manifest.indexedPages,debug:process.env.NODE_ENV==='development'&&process.env.TUTOR_DIAGNOSTICS==='true'},{headers:{'Cache-Control':'no-store'}});}
