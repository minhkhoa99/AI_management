import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static HTML export: no Next.js server at runtime, NestJS serves the files.
  output: 'export',
  // Emits org/index.html etc. so a plain static file server resolves /org/.
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@aiteam/contracts'],
};

export default nextConfig;
