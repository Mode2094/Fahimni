import { SECRET_KEYS, SETTING_KEYS } from '../settings/keys';
import { getPlainSetting, getSecretSetting } from '../settings/service';

export type FreemiusCredentials = {
  productId: string | null;
  apiKey: string | null;
  secretKey: string | null;
  publicKey: string | null;
  developerId: string | null;
  developerSecret: string | null;
};

// Database-managed credentials win; environment variables remain as an
// optional bootstrap fallback so an existing deployment keeps working.
export async function freemiusCredentials(env: NodeJS.ProcessEnv = process.env): Promise<FreemiusCredentials> {
  const [productId, apiKey, secretKey, publicKey, developerId, developerSecret] = await Promise.all([
    getPlainSetting(SETTING_KEYS.freemiusProductId).catch(() => null),
    getSecretSetting(SECRET_KEYS.freemiusApiKey).catch(() => null),
    getSecretSetting(SECRET_KEYS.freemiusSecretKey).catch(() => null),
    getSecretSetting(SECRET_KEYS.freemiusPublicKey).catch(() => null),
    getPlainSetting(SETTING_KEYS.freemiusDeveloperId).catch(() => null),
    getSecretSetting(SECRET_KEYS.freemiusDeveloperSecret).catch(() => null),
  ]);
  return {
    productId: productId?.trim() || env.FREEMIUS_PRODUCT_ID?.trim() || null,
    apiKey: apiKey?.trim() || env.FREEMIUS_API_KEY?.trim() || null,
    secretKey: secretKey?.trim() || env.FREEMIUS_SECRET_KEY?.trim() || null,
    publicKey: publicKey?.trim() || env.FREEMIUS_PUBLIC_KEY?.trim() || null,
    developerId: developerId?.trim() || env.FREEMIUS_DEVELOPER_ID?.trim() || null,
    developerSecret: developerSecret?.trim() || env.FREEMIUS_DEVELOPER_SECRET?.trim() || null,
  };
}

export function credentialsComplete(credentials: FreemiusCredentials): boolean {
  return Boolean(credentials.productId && credentials.apiKey && credentials.secretKey && credentials.publicKey);
}
