import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { getDb } from '../../db';
import {
  aiUsageEvents,
  creditLedger,
  creditWallets,
  subscriptionPurchases,
  topupPurchases,
} from '../../db/schema';
import { microUsdToUsd } from '../trial/config';

// Admin financial reporting. Every number is derived from real rows: purchases,
// ledger entries and recorded usage. Nothing is invented. Estimated provider
// costs (pre-call reservations) are reported separately from measured ones.

export type FinancialFilters = {
  semesterId?: string | null;
  from?: Date | null;
  to?: Date | null;
};

export type FinancialSummary = {
  subscriptionRevenueMinor: number;
  topupRevenueMinor: number;
  currency: string;
  activeSubscribers: number;
  scheduledSubscribers: number;
  expiredSubscribers: number;
  verifiedPayments: number;
  refunds: number;
  creditsGrantedSemester: number;
  creditsGrantedTopup: number;
  creditsConsumedSemester: number;
  creditsConsumedTopup: number;
  // Outstanding liability: credits still held by students (both buckets).
  creditLiability: number;
  // Provider cost: estimated reservations recorded on usage events (micro-USD).
  estimatedProviderCostMicroUsd: number;
  measuredProviderCostMicroUsd: number;
};

export async function financialSummary(filters: FinancialFilters = {}): Promise<FinancialSummary> {
  const db = getDb();
  const purchaseWhere = [
    inArray(subscriptionPurchases.status, ['ACTIVE', 'CANCELED', 'EXPIRED']),
  ];
  if (filters.semesterId) purchaseWhere.push(eq(subscriptionPurchases.semesterId, filters.semesterId));
  if (filters.from) purchaseWhere.push(gte(subscriptionPurchases.createdAt, filters.from));
  if (filters.to) purchaseWhere.push(lte(subscriptionPurchases.createdAt, filters.to));

  const [subs] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${subscriptionPurchases.priceMinor}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(subscriptionPurchases)
    .where(and(...purchaseWhere));

  const [active] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subscriptionPurchases)
    .where(and(eq(subscriptionPurchases.status, 'ACTIVE'), sql`${subscriptionPurchases.startsAt} <= now()`, sql`${subscriptionPurchases.expiresAt} > now()`));
  const [scheduled] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subscriptionPurchases)
    .where(and(eq(subscriptionPurchases.status, 'ACTIVE'), sql`${subscriptionPurchases.startsAt} > now()`));
  const [expired] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subscriptionPurchases)
    .where(inArray(subscriptionPurchases.status, ['EXPIRED', 'CANCELED']));

  const [topups] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${topupPurchases.priceMinor}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(topupPurchases)
    .where(eq(topupPurchases.status, 'ACTIVE'));

  const [refunds] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subscriptionPurchases)
    .where(eq(subscriptionPurchases.status, 'REFUNDED'));

  const [ledger] = await db
    .select({
      grantedSemester: sql<number>`coalesce(sum(case when ${creditLedger.bucket} = 'SEMESTER' and ${creditLedger.kind} in ('GRANT') then ${creditLedger.delta} else 0 end), 0)::int`,
      grantedTopup: sql<number>`coalesce(sum(case when ${creditLedger.bucket} = 'TOPUP' and ${creditLedger.kind} = 'TOPUP_PURCHASE' then ${creditLedger.delta} else 0 end), 0)::int`,
      consumedSemester: sql<number>`coalesce(sum(case when ${creditLedger.bucket} = 'SEMESTER' and ${creditLedger.kind} = 'CONSUME' then -${creditLedger.delta} else 0 end), 0)::int`,
      consumedTopup: sql<number>`coalesce(sum(case when ${creditLedger.bucket} = 'TOPUP' and ${creditLedger.kind} = 'CONSUME' then -${creditLedger.delta} else 0 end), 0)::int`,
    })
    .from(creditLedger);

  const [liability] = await db
    .select({
      total: sql<number>`coalesce(sum(${creditWallets.semesterBalance} + ${creditWallets.topupBalance}), 0)::int`,
    })
    .from(creditWallets);

  const usageWhere = [];
  if (filters.from) usageWhere.push(gte(aiUsageEvents.createdAt, filters.from));
  if (filters.to) usageWhere.push(lte(aiUsageEvents.createdAt, filters.to));
  const [usage] = await db
    .select({
      estimated: sql<number>`coalesce(sum(${aiUsageEvents.estimatedCostMicroUsd}), 0)::bigint`,
    })
    .from(aiUsageEvents)
    .where(usageWhere.length ? and(...usageWhere) : undefined);

  return {
    subscriptionRevenueMinor: subs?.revenue ?? 0,
    topupRevenueMinor: topups?.revenue ?? 0,
    currency: 'JOD',
    activeSubscribers: active?.count ?? 0,
    scheduledSubscribers: scheduled?.count ?? 0,
    expiredSubscribers: expired?.count ?? 0,
    verifiedPayments: (subs?.count ?? 0) + (topups?.count ?? 0),
    refunds: refunds?.count ?? 0,
    creditsGrantedSemester: ledger?.grantedSemester ?? 0,
    creditsGrantedTopup: ledger?.grantedTopup ?? 0,
    creditsConsumedSemester: ledger?.consumedSemester ?? 0,
    creditsConsumedTopup: ledger?.consumedTopup ?? 0,
    creditLiability: liability?.total ?? 0,
    // Tests and the admin card present these in USD micro-units; the UI converts.
    estimatedProviderCostMicroUsd: Number(usage?.estimated ?? 0),
    measuredProviderCostMicroUsd: 0,
  };
}

export type ProfitabilityAssumptions = {
  semesterPriceMinor: number;
  includedCredits: number;
  expectedSubscribers: number;
  avgAiCostPerStudentUsd: number;
  paymentFeePercent: number;
  paymentFeeFixedMinor: number;
  acquisitionCostPerCustomerMinor: number;
  fixedOperatingExpensesMinor: number;
  avgTopupRevenuePerStudentMinor: number;
  avgTopupCreditsCostUsd: number;
};

export type ProfitabilityResult = {
  grossSubscriptionRevenueMinor: number;
  grossTopupRevenueMinor: number;
  grossRevenueMinor: number;
  variableAiCostMinor: number;
  paymentFeesMinor: number;
  acquisitionCostMinor: number;
  fixedCostsMinor: number;
  totalVariableMinor: number;
  contributionPerSubscriberMinor: number;
  contributionMarginMinor: number;
  breakEvenSubscribers: number;
  projectedSurplusMinor: number;
  // Explicitly separated so revenue is never labelled profit.
  estimatedProviderCostUsd: number;
};

// Turns admin assumptions into a projection. Currency conversion is disclosed:
// the AI cost is entered in USD and converted with a caller-provided minor-unit
// rate (default: JOD has 3 decimals, ~1:1 placeholder is NOT used — the admin
// enters the minor-unit cost directly via `aiCostMinorPerStudent`).
export function projectProfitability(input: {
  assumptions: ProfitabilityAssumptions;
  usdToMinor: number;
}): ProfitabilityResult {
  const a = input.assumptions;
  const subscribers = Math.max(0, a.expectedSubscribers);
  const grossSubscriptionRevenueMinor = a.semesterPriceMinor * subscribers;
  const grossTopupRevenueMinor = a.avgTopupRevenuePerStudentMinor * subscribers;
  const grossRevenueMinor = grossSubscriptionRevenueMinor + grossTopupRevenueMinor;

  const aiCostPerStudentMinor = Math.round(a.avgAiCostPerStudentUsd * input.usdToMinor);
  const topupCostPerStudentMinor = Math.round(a.avgTopupCreditsCostUsd * input.usdToMinor);
  const variableAiCostMinor = (aiCostPerStudentMinor + topupCostPerStudentMinor) * subscribers;
  const paymentFeesMinor = subscribers === 0
    ? 0
    : Math.round(((grossRevenueMinor * a.paymentFeePercent) / 100) + a.paymentFeeFixedMinor * subscribers);
  const acquisitionCostMinor = a.acquisitionCostPerCustomerMinor * subscribers;
  const fixedCostsMinor = a.fixedOperatingExpensesMinor;

  const totalVariableMinor = variableAiCostMinor + paymentFeesMinor + acquisitionCostMinor;
  const contributionMarginMinor = grossRevenueMinor - totalVariableMinor;
  const contributionPerSubscriberMinor = subscribers > 0 ? Math.round(contributionMarginMinor / subscribers) : 0;
  const perSubscriberContribution = a.semesterPriceMinor + a.avgTopupRevenuePerStudentMinor - Math.round(totalVariableMinor / Math.max(1, subscribers));
  const breakEvenSubscribers = perSubscriberContribution > 0 ? Math.ceil(fixedCostsMinor / perSubscriberContribution) : 0;
  const projectedSurplusMinor = contributionMarginMinor - fixedCostsMinor;

  return {
    grossSubscriptionRevenueMinor,
    grossTopupRevenueMinor,
    grossRevenueMinor,
    variableAiCostMinor,
    paymentFeesMinor,
    acquisitionCostMinor,
    fixedCostsMinor,
    totalVariableMinor,
    contributionPerSubscriberMinor,
    contributionMarginMinor,
    breakEvenSubscribers,
    projectedSurplusMinor,
    estimatedProviderCostUsd: microUsdToUsd(0),
  };
}

export type LedgerExportRow = {
  createdAt: Date;
  userId: string;
  bucket: string;
  kind: string;
  delta: number;
  balanceAfter: number;
  note: string | null;
};

export async function ledgerExport(limit = 1000): Promise<LedgerExportRow[]> {
  const db = getDb();
  return db
    .select({
      createdAt: creditLedger.createdAt,
      userId: creditLedger.userId,
      bucket: creditLedger.bucket,
      kind: creditLedger.kind,
      delta: creditLedger.delta,
      balanceAfter: creditLedger.balanceAfter,
      note: creditLedger.note,
    })
    .from(creditLedger)
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit);
}

// Converts a rows array to a CSV string with a UTF-8 BOM so Excel opens Arabic
// columns correctly. Header names are stable English keys for tooling.
export function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const escape = (value: unknown): string => {
    const text = value instanceof Date ? value.toISOString() : String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((header) => escape(row[header])).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
