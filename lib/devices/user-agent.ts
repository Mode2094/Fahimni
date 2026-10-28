// Friendly device labels from the User-Agent header; no fingerprinting.
export function summarizeUserAgent(userAgent: string | null | undefined): { name: string; summary: string | null } {
  const ua = (userAgent ?? '').trim();
  if (!ua) return { name: 'جهاز غير معروف', summary: null };

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : 'متصفح';

  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'جهاز';

  return { name: `${browser} · ${os}`, summary: ua.slice(0, 160) };
}
