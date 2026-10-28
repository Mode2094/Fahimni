import { desc } from 'drizzle-orm';

import { getDb } from '../../db';
import { webhookEvents } from '../../db/schema';

export type WebhookEventSummary = { type: string; createdAt: Date } | null;

// Latest recorded Freemius webhook event for the settings status card. Reads
// metadata only — never payloads.
export async function latestWebhookEvent(): Promise<WebhookEventSummary> {
  try {
    const rows = await getDb()
      .select({ type: webhookEvents.type, createdAt: webhookEvents.createdAt })
      .from(webhookEvents)
      .orderBy(desc(webhookEvents.createdAt))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
