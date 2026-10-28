export type SecurityHeaderOptions = { production: boolean; https: boolean };

function contentSecurityPolicy(production: boolean): string {
  const scriptSrc = production
    ? "script-src 'self' 'unsafe-inline' https://checkout.freemius.com https://accounts.google.com"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.freemius.com https://accounts.google.com";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://checkout.freemius.com https://api.freemius.com",
    "frame-src https://checkout.freemius.com https://accounts.google.com",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.freemius.com",
    "frame-ancestors 'none'",
  ].join('; ');
}

// Headers are compatible with Google OAuth, Freemius checkout, OpenAI (server
// only), blob media previews, KaTeX inline styles and the PWA service worker.
export function buildSecurityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': contentSecurityPolicy(options.production),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=()',
    'X-Frame-Options': 'DENY',
  };
  // HSTS only for production traffic that arrived over HTTPS.
  if (options.production && options.https) {
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  }
  return headers;
}
