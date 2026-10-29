import { and, isNotNull, lt, or } from 'drizzle-orm';

import { getDb } from '../../db';
import { aiUsageEvents, billingEvents, registeredDevices, settingAuditLog, webhookEvents } from '../../db/schema';

// Privacy-conscious retention policy (durations in days). Learning progress is
// student-owned learning data and is NOT auto-deleted; it only leaves through
// the explicit student-data deletion procedure.
export const RETENTION_DAYS = {
  webhookEvents: 180,
  aiUsageEvents: 400,
  billingEvents: 400,
  settingAuditLog: 400,
  staleDevices: 180,
} as const;

export type PruneReport = {
  webhookEvents: number;
  aiUsageEvents: number;
  billingEvents: number;
  settingAuditLog: number;
  staleDevices: number;
};

function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// Idempotent retention pass. Runs inside a transaction; returns deleted counts.
export async function pruneOldData(now = new Date()): Promise<PruneReport> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const webhooks = await tx
      .delete(webhookEvents)
      .where(and(isNotNull(webhookEvents.processedAt), lt(webhookEvents.createdAt, cutoff(now, RETENTION_DAYS.webhookEvents))))
      .returning({ id: webhookEvents.id });
    const usage = await tx
      .delete(aiUsageEvents)
      .where(lt(aiUsageEvents.createdAt, cutoff(now, RETENTION_DAYS.aiUsageEvents)))
      .returning({ id: aiUsageEvents.id });
    const billing = await tx
      .delete(billingEvents)
      .where(lt(billingEvents.createdAt, cutoff(now, RETENTION_DAYS.billingEvents)))
      .returning({ id: billingEvents.id });
    const audit = await tx
      .delete(settingAuditLog)
      .where(lt(settingAuditLog.createdAt, cutoff(now, RETENTION_DAYS.settingAuditLog)))
      .returning({ id: settingAuditLog.id });
    // Devices that were revoked or have not been seen for a long time.
    const devices = await tx
      .delete(registeredDevices)
      .where(
        or(
          and(isNotNull(registeredDevices.revokedAt), lt(registeredDevices.revokedAt, cutoff(now, RETENTION_DAYS.staleDevices))),
          and(isNotNull(registeredDevices.lastSeenAt), lt(registeredDevices.lastSeenAt, cutoff(now, RETENTION_DAYS.staleDevices))),
        ),
      )
      .returning({ id: registeredDevices.id });
    return {
      webhookEvents: webhooks.length,
      aiUsageEvents: usage.length,
      billingEvents: billing.length,
      settingAuditLog: audit.length,
      staleDevices: devices.length,
    };
  });
}
