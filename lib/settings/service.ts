import { eq } from 'drizzle-orm';

import { getDb } from '../../db';
import { secureSettings, settingAuditLog, systemSettings } from '../../db/schema';
import { decryptSecret, encryptSecret, encryptionConfigured, SettingsCryptoError } from './crypto';

export type SettingActor = { id: string; email: string } | null;

// Test seam for the read paths. Production leaves this null and every read goes
// to the database. Tests that exercise the AI pipeline install an in-memory
// reader so a request never opens a database connection: in CI (real
// PostgreSQL) an unoverridden read leaves a pending pool promise that cancels
// sibling tests under the Node test runner.
export type SettingsReader = {
  getPlain(key: string): Promise<string | null>;
  getSecret(key: string): Promise<string | null>;
  getSecretPresence(key: string): Promise<boolean>;
};

let readerOverride: SettingsReader | null = null;

export function setSettingsReaderForTests(reader: SettingsReader | null): void {
  readerOverride = reader;
}

// Settings are always read from the database (single indexed primary-key read)
// so an admin save is visible to every process immediately — no cache can go
// stale, and no restart is ever required.
export function invalidateSettingsCache(): void {
  // Kept for API compatibility; reads are uncached by design.
}

export async function recordSettingAudit(input: {
  scope: 'plain' | 'secret';
  key: string;
  action: 'set' | 'delete' | 'test';
  actor: SettingActor;
  detail?: string | null;
}): Promise<void> {
  try {
    await getDb().insert(settingAuditLog).values({
      id: crypto.randomUUID(),
      scope: input.scope,
      key: input.key,
      action: input.action,
      actorId: input.actor?.id ?? null,
      actorEmail: input.actor?.email ?? null,
      detail: input.detail ?? null,
    });
  } catch {
    // Auditing must never break the settings write itself.
    console.warn('[settings] audit write failed', input.key, input.action);
  }
}

export async function getPlainSetting(key: string): Promise<string | null> {
  if (readerOverride) return readerOverride.getPlain(key);
  const rows = await getDb().select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setPlainSetting(key: string, value: string, actor: SettingActor = null): Promise<void> {
  await getDb()
    .insert(systemSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } });
  await recordSettingAudit({ scope: 'plain', key, action: 'set', actor });
}

// Missing ciphertext → null. Undecryptable ciphertext → null plus a safe
// warning (fail closed); the caller treats the credential as unconfigured.
export async function getSecretSetting(key: string): Promise<string | null> {
  if (readerOverride) return readerOverride.getSecret(key);
  const rows = await getDb().select({ ciphertext: secureSettings.ciphertext }).from(secureSettings).where(eq(secureSettings.key, key)).limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    return decryptSecret(row.ciphertext);
  } catch (error) {
    console.warn('[settings] secret unavailable', key, error instanceof SettingsCryptoError ? error.code : 'error');
    return null;
  }
}

export async function getSecretPresence(key: string): Promise<boolean> {
  if (readerOverride) return readerOverride.getSecretPresence(key);
  const rows = await getDb().select({ key: secureSettings.key }).from(secureSettings).where(eq(secureSettings.key, key)).limit(1);
  return Boolean(rows[0]);
}

export async function setSecretSetting(key: string, value: string, actor: SettingActor = null): Promise<void> {
  const ciphertext = encryptSecret(value);
  const existed = await getSecretPresence(key);
  await getDb()
    .insert(secureSettings)
    .values({ key, ciphertext, updatedAt: new Date(), updatedBy: actor?.id ?? null })
    .onConflictDoUpdate({ target: secureSettings.key, set: { ciphertext, updatedAt: new Date(), updatedBy: actor?.id ?? null } });
  await recordSettingAudit({ scope: 'secret', key, action: 'set', actor, detail: existed ? 'replaced' : 'created' });
}

export async function deleteSecretSetting(key: string, actor: SettingActor = null): Promise<void> {
  await getDb().delete(secureSettings).where(eq(secureSettings.key, key));
  await recordSettingAudit({ scope: 'secret', key, action: 'delete', actor });
}

export { encryptionConfigured };
