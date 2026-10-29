const FALLBACK_RETURN_TO = '/app';
const INTERNAL_BASE = 'https://app.local';

export function safeReturnTo(value: string | null | undefined, fallback = FALLBACK_RETURN_TO): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  try {
    const url = new URL(value, INTERNAL_BASE);
    if (url.origin !== INTERNAL_BASE) return fallback;
    if (!url.pathname.startsWith('/')) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function loginPathFor(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

// The browser cannot forge the Host header it is connecting to; the scheme may
// come from a TLS-terminating proxy. X-Forwarded-Host is deliberately ignored.
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const protocol = forwarded === 'https' || forwarded === 'http' ? forwarded : url.protocol.replace(':', '');
  const host = request.headers.get('host')?.trim() || url.host;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return url.origin;
  }
}
