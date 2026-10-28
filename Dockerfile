# =============================================================================
# UCSS — production image (API + built web UI on one port)
#   docker compose up -d --build        # recommended: brings Postgres along
# =============================================================================

# ─── Stage 1: build ──────────────────────────────────────────────────────────
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
RUN pnpm --filter @ucss/database exec prisma generate \
 && pnpm --filter @ucss/shared run build \
 && pnpm --filter @ucss/database run build \
 && pnpm --filter @ucss/api run build \
 && pnpm --filter @ucss/web run build

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl ca-certificates tzdata wget

# The API is a single esbuild bundle; only Prisma (native engines) is installed separately.
# Keep PRISMA_VERSION in step with packages/database/package.json.
ARG PRISMA_VERSION=6.19.3
COPY packages/database/prisma ./prisma
RUN echo "{\"name\":\"ucss-runtime\",\"private\":true,\"type\":\"module\",\"dependencies\":{\"@prisma/client\":\"${PRISMA_VERSION}\",\"prisma\":\"${PRISMA_VERSION}\"}}" > package.json \
 && npm install --omit=dev --no-audit --no-fund \
 && node_modules/.bin/prisma generate --schema=prisma/schema.prisma

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/web/dist ./public
COPY scripts/docker-entrypoint.sh ./entrypoint.sh

ENV NODE_ENV=production \
    PORT=4000 \
    UPLOAD_TMP_DIR=/tmp/ucss-uploads

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 ucss --ingroup nodejs \
 && chmod +x entrypoint.sh && mkdir -p /tmp/ucss-uploads && chown -R ucss:nodejs /app /tmp/ucss-uploads
USER ucss

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/api/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
