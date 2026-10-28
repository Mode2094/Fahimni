import { checkHealth } from '../../../lib/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await checkHealth();
  return Response.json(report, {
    status: report.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
