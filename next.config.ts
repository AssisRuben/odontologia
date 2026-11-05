import type { NextConfig } from "next";

const publicHeaders = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'X-Robots-Tag', value: 'noindex' },
]

const nextConfig: NextConfig = {
  // Página e API públicas do orçamento: nunca em cache nem indexadas
  async headers() {
    return [
      { source: '/orcamento/:path*', headers: publicHeaders },
      { source: '/api/public/:path*', headers: publicHeaders },
    ]
  },
};

export default nextConfig;
