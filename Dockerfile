# Imagem de produção do app (Next.js standalone), usada pelo Coolify.
#
# As variáveis NEXT_PUBLIC_* entram no JavaScript do navegador durante o build,
# então precisam chegar como build args. No Coolify, marque-as como
# "Build Variable" (as demais variáveis ficam só em tempo de execução).

FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ── Dependências ────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
# O pacote playwright (devDependency) só é usado pelos scripts locais do manual/demo;
# não baixa navegadores aqui.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# ── Build ───────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Execução ────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Capítulos do manual (lidos do disco em tempo de execução).
COPY --from=builder --chown=nextjs:nodejs /app/src/content/ajuda ./src/content/ajuda

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
