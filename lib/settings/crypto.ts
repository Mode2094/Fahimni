import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type SettingsCryptoErrorCode = 'missing_root_key' | 'invalid_root_key' | 'decrypt_failed';

export class SettingsCryptoError extends Error {
  constructor(public code: SettingsCryptoErrorCode) {
    super(code);
    this.name = 'SettingsCryptoError';
  }
}

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

// The encryption root key never lives in the database. Accepts 32 raw bytes as
// hex (64 chars) or base64. Anything else is treated as a misconfiguration.
export function parseRootKey(value: string | undefined): Buffer | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {
    return null;
  }
  return null;
}

export function encryptionConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseRootKey(env.SETTINGS_ENCRYPTION_KEY) !== null;
}

export function encryptionRootKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const key = parseRootKey(env.SETTINGS_ENCRYPTION_KEY);
  if (key) return key;
  throw new SettingsCryptoError(env.SETTINGS_ENCRYPTION_KEY?.trim() ? 'invalid_root_key' : 'missing_root_key');
}

export function encryptSecret(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = encryptionRootKey(env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

// Fails closed: any tampering, truncation or wrong key throws instead of
// returning partial plaintext.
export function decryptSecret(payload: string, env: NodeJS.ProcessEnv = process.env): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SettingsCryptoError('decrypt_failed');
  try {
    const key = encryptionRootKey(env);
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SettingsCryptoError('decrypt_failed');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof SettingsCryptoError) throw error;
    throw new SettingsCryptoError('decrypt_failed');
  }
}
