import type { NextConfig } from "next";

const publicHeaders = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'X-Robots-Tag', value: 'noindex' },
]

const nextConfig: NextConfig = {
  // Só no `npm run dev`: deixa o celular abrir o app pelo túnel do Cloudflare
  // (sem isso o Next bloqueia os arquivos de desenvolvimento e a página não funciona).
  allowedDevOrigins: ['*.trycloudflare.com'],

  // O proxy guarda o corpo da requisição em memória (padrão 10 MB, truncando o excedente).
  // A transcrição aceita áudio de até 25 MB, então o limite sobe para 26 MB.
  experimental: {
    proxyClientMaxBodySize: '26mb',
  },

  // Página e API públicas do orçamento: nunca em cache nem indexadas
  async headers() {
    return [
      { source: '/orcamento/:path*', headers: publicHeaders },
      { source: '/api/public/:path*', headers: publicHeaders },
    ]
  },
};

export default nextConfig;
