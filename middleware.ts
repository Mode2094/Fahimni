import { NextResponse, type NextRequest } from 'next/server';

import { buildSecurityHeaders } from './lib/security/headers';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const https = forwardedProto === 'https' || request.nextUrl.protocol === 'https:';
  const headers = buildSecurityHeaders({ production: process.env.NODE_ENV === 'production', https });
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.svg|icons/|fonts/|book/|sw.js|manifest.webmanifest).*)'],
};
