# =============================================================================
# Production Multi-Stage Dockerfile for UCSS API Monolith
# (Build context must be repository root: docker build -f apps/api/Dockerfile .)
# =============================================================================

FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps ./apps

RUN pnpm --filter @ucss/database exec prisma generate
RUN pnpm --filter @ucss/shared run build
RUN pnpm --filter @ucss/database run build
RUN pnpm --filter @ucss/api run build
RUN pnpm --filter @ucss/web run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl ca-certificates tzdata

ENV NODE_ENV=production
ENV PORT=4000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 ucss --ingroup nodejs

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/packages/database/prisma ./prisma
COPY --from=builder /app/packages/database/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/apps/web/dist ./public

RUN chown -R ucss:nodejs /app

USER ucss

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "dist/server.js"]
