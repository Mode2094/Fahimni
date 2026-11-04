import { authorizeAdminRequest, forbidden } from '../../../../../../lib/admin/http';
import { ledgerExport, toCsv } from '../../../../../../lib/admin/financials';
import { semesterStore } from '../../../../../../lib/billing/semester-store';
import { purchaseStore } from '../../../../../../lib/billing/purchase-store';

export const dynamic = 'force-dynamic';

// CSV exports for the financial tab. `kind=ledger` exports the credit ledger;
// `kind=subscribers&semesterId=...` exports one semester's subscribers.
// A UTF-8 BOM keeps Arabic columns readable in Excel.
export async function GET(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? 'ledger';

  if (kind === 'subscribers') {
    const semesterId = url.searchParams.get('semesterId');
    if (!semesterId) return new Response('Missing semesterId', { status: 400 });
    const rows = await semesterStore().listSubscribers(semesterId);
    const csv = toCsv(
      rows.map((row) => ({
        purchase_id: row.purchaseId,
        user_id: row.userId,
        email: row.userEmail,
        name: row.userName ?? '',
        status: row.status,
        starts_at: row.startsAt,
        expires_at: row.expiresAt,
        price_minor: row.priceMinor,
        currency: row.currency,
        included_credits: row.includedCredits,
        credits_granted_at: row.creditsGrantedAt,
        purchased_at: row.createdAt,
      })),
      ['purchase_id', 'user_id', 'email', 'name', 'status', 'starts_at', 'expires_at', 'price_minor', 'currency', 'included_credits', 'credits_granted_at', 'purchased_at'],
    );
    return csvResponse(csv, `semester-${semesterId}-subscribers.csv`);
  }

  if (kind === 'purchases') {
    const semesterId = url.searchParams.get('semesterId');
    const rows = semesterId
      ? await purchaseStore().listPurchasesForSemester(semesterId)
      : (await Promise.all([])) as never;
    const csv = toCsv(
      (rows as Array<Record<string, unknown>>).map((row) => ({
        purchase_id: row.id,
        user_id: row.userId,
        semester_id: row.semesterId,
        status: row.status,
        price_minor: row.priceMinor,
        currency: row.currency,
        included_credits: row.includedCredits,
        starts_at: row.startsAt,
        expires_at: row.expiresAt,
        purchased_at: row.createdAt,
      })),
      ['purchase_id', 'user_id', 'semester_id', 'status', 'price_minor', 'currency', 'included_credits', 'starts_at', 'expires_at', 'purchased_at'],
    );
    return csvResponse(csv, `semester-${semesterId ?? 'all'}-purchases.csv`);
  }

  const rows = await ledgerExport(2000);
  const csv = toCsv(
    rows.map((row) => ({
      created_at: row.createdAt,
      user_id: row.userId,
      bucket: row.bucket,
      kind: row.kind,
      delta: row.delta,
      balance_after: row.balanceAfter,
      note: row.note ?? '',
    })),
    ['created_at', 'user_id', 'bucket', 'kind', 'delta', 'balance_after', 'note'],
  );
  return csvResponse(csv, 'credit-ledger.csv');
}

function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
