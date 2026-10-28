import { desc } from 'drizzle-orm';

import { getDb } from '../../db';
import { billingEvents } from '../../db/schema';

export type BillingEventRecord = {
  id: string;
  provider: string;
  type: string;
  licenseId: string | null;
  subscriptionId: string | null;
  userEmail: string | null;
  summary: string;
  createdAt: Date;
};

export type BillingEventInput = {
  type: string;
  licenseId?: string | null;
  subscriptionId?: string | null;
  userEmail?: string | null;
  summary: string;
  createdAt?: Date;
};

export type BillingEventStore = {
  record(input: BillingEventInput): Promise<void>;
  list(limit: number): Promise<BillingEventRecord[]>;
};

function createDrizzleBillingEventStore(): BillingEventStore {
  return {
    async record(input) {
      await getDb()
        .insert(billingEvents)
        .values({
          id: crypto.randomUUID(),
          provider: 'freemius',
          type: input.type,
          licenseId: input.licenseId ?? null,
          subscriptionId: input.subscriptionId ?? null,
          userEmail: input.userEmail ?? null,
          summary: input.summary,
          createdAt: input.createdAt ?? new Date(),
        });
    },
    async list(limit) {
      return getDb()
        .select({
          id: billingEvents.id,
          provider: billingEvents.provider,
          type: billingEvents.type,
          licenseId: billingEvents.licenseId,
          subscriptionId: billingEvents.subscriptionId,
          userEmail: billingEvents.userEmail,
          summary: billingEvents.summary,
          createdAt: billingEvents.createdAt,
        })
        .from(billingEvents)
        .orderBy(desc(billingEvents.createdAt))
        .limit(limit);
    },
  };
}

let override: BillingEventStore | null = null;

export function setBillingEventStoreForTests(store: BillingEventStore | null): void {
  override = store;
}

export function billingEventStore(): BillingEventStore {
  return override ?? createDrizzleBillingEventStore();
}

// Arabic summaries for the admin timeline. Only verified provider events reach
// this list — never raw payloads, tokens or keys.
export const BILLING_EVENT_SUMMARIES: Record<string, string> = {
  'subscription.renewal.failed': 'فشل تجديد الدفع — ستعيد فريميوس المحاولة تلقائيًا.',
  'subscription.renewal.failed.last': 'فشل تجديد الدفع في المحاولة الأخيرة — قد يُوقف الوصول عند انتهاء المدة المدفوعة.',
  'license.cancelled': 'تم إلغاء الاشتراك من بوابة الدفع.',
  'license.expired': 'انتهى الاشتراك ولم يتم التجديد.',
  'license.shortened': 'تم تقصير مدة الاشتراك (قد يشمل استرجاعًا جزئيًا).',
  'license.plan.changed': 'تم تغيير خطة الاشتراك.',
  'license.deleted': 'حُذف الاشتراك نهائيًا من فريميوس وأُزيل وصوله.',
  'license.updated': 'تحديث على بيانات الاشتراك.',
};

export function summaryForBillingEvent(type: string): string {
  return BILLING_EVENT_SUMMARIES[type] ?? `حدث فوترة: ${type}`;
}
