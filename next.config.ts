import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native Next.js generated types separate from the Sites build.
  distDir: '.next-native',
  experimental: {
    // PDF textbooks can be up to 100MB (MAX_PDF_BYTES). Next.js buffers the
    // request body when proxy.ts runs; the 10MB default truncated multipart
    // uploads and made request.formData() throw (HTTP 500 on book upload).
    // 110MB covers the 100MB file plus multipart overhead.
    proxyClientMaxBodySize: '110mb',
  },
};

export default nextConfig;
