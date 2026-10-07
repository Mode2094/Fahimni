import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native Next.js generated types separate from the Sites build.
  distDir: '.next-native',
};

export default nextConfig;
