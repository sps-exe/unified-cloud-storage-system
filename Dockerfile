# =============================================================================
# Production Multi-Stage Dockerfile for Unified Cloud Storage System (UCSS)
# Monolithic Backend with Streaming File Engine & Prisma ORM
# =============================================================================

# ─── Stage 1: Build Environment ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install system dependencies (build-base, python3 for native addons if needed)
RUN apk add --no-cache libc6-compat openssl

# Install pnpm package manager
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

# Copy monorepo configuration files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install dependencies with frozen lockfile
RUN pnpm install --frozen-lockfile

# Copy source code across all packages
COPY packages ./packages
COPY apps ./apps

# Generate Prisma Client & Run esbuild bundles
RUN pnpm --filter @ucss/database exec prisma generate
RUN pnpm --filter @ucss/shared run build
RUN pnpm --filter @ucss/database run build
RUN pnpm --filter @ucss/api run build
RUN pnpm --filter @ucss/web run build

# ─── Stage 2: Production Runtime ─────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install minimal runtime dependencies (OpenSSL required for Prisma)
RUN apk add --no-cache openssl ca-certificates tzdata

ENV NODE_ENV=production
ENV PORT=4000

# Create non-root system user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 ucss --ingroup nodejs

# Copy built server bundle and production dependencies
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/packages/database/prisma ./prisma
COPY --from=builder /app/packages/database/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/apps/web/dist ./public

# Ensure write permissions for temp uploads and logs
RUN chown -R ucss:nodejs /app

USER ucss

EXPOSE 4000

# Built-in container healthcheck against Express /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "dist/server.js"]
