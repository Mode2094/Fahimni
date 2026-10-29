import { Freemius } from '@freemius/sdk';

import { credentialsComplete, freemiusCredentials } from './credentials';

export class FreemiusConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FreemiusConfigError';
  }
}

export async function freemiusConfigured(): Promise<boolean> {
  const credentials = await freemiusCredentials().catch(() => null);
  return credentials ? credentialsComplete(credentials) : false;
}

let override: Freemius | null | undefined;
let client: Freemius | null = null;
let clientKey: string | null = null;

function fingerprint(productId: string, apiKey: string, secretKey: string, publicKey: string): string {
  return [productId, apiKey, secretKey, publicKey].join('\u0000');
}

// Server-only singleton, rebuilt automatically when the stored credentials
// change so a key rotation takes effect without a restart. API key, secret key
// and public key must never reach a client bundle; this module is imported
// exclusively from server code.
export async function freemiusClient(): Promise<Freemius> {
  if (override !== undefined) {
    if (!override) throw new FreemiusConfigError('Freemius is not configured.');
    return override;
  }
  const credentials = await freemiusCredentials();
  if (!credentialsComplete(credentials)) throw new FreemiusConfigError('Freemius is not configured.');
  const key = fingerprint(credentials.productId as string, credentials.apiKey as string, credentials.secretKey as string, credentials.publicKey as string);
  if (!client || clientKey !== key) {
    client = new Freemius({
      productId: credentials.productId as string,
      apiKey: credentials.apiKey as string,
      secretKey: credentials.secretKey as string,
      publicKey: credentials.publicKey as string,
    });
    clientKey = key;
  }
  return client;
}

export function setFreemiusClientForTests(value: Freemius | null): void {
  override = value === null ? undefined : value;
  if (value === null) {
    client = null;
    clientKey = null;
  }
}
