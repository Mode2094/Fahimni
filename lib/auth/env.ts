import { AuthConfigError } from './errors';

export { AuthConfigError };

export type AuthEnv = {
  databaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  authSecret: string;
  adminEmails: string[];
  secureCookies: boolean;
};

// Development convenience only; production rejects a missing AUTH_SECRET.
const DEV_AUTH_SECRET = 'fahimni-dev-only-auth-secret';

export function authSecret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new AuthConfigError('AUTH_SECRET is required in production.');
  return DEV_AUTH_SECRET;
}

export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string, adminEmails: readonly string[]): boolean {
  return adminEmails.includes(email.trim().toLowerCase());
}

export function authEnv(): AuthEnv {
  const production = process.env.NODE_ENV === 'production';
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  const configuredSecret = process.env.AUTH_SECRET?.trim() ?? '';

  if (!databaseUrl) throw new AuthConfigError('DATABASE_URL is required.');
  if (!googleClientId || !googleClientSecret) {
    throw new AuthConfigError('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required.');
  }

  let authSecret = configuredSecret;
  if (!authSecret) {
    if (production) throw new AuthConfigError('AUTH_SECRET is required in production.');
    authSecret = DEV_AUTH_SECRET;
  }

  return {
    databaseUrl,
    googleClientId,
    googleClientSecret,
    authSecret,
    adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
    secureCookies: production,
  };
}
