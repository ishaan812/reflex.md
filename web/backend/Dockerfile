# ── Stage 1: install + generate + build ────────────────────────────
FROM node:20-slim AS build

# OpenSSL needed for Prisma to detect correct engine binary
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy dependency manifests for layer caching
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

RUN pnpm install --frozen-lockfile

# Generate Prisma client (with correct binary for linux)
RUN pnpm prisma:generate

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src ./src/

RUN pnpm build

# ── Stage 2: production image ─────────────────────────────────────
FROM node:20-slim AS production

# git: required by simple-git for cloning repos
# openssl: required by Prisma engine at runtime
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates openssl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy node_modules with generated Prisma client + prisma CLI (needed for migrate)
COPY --from=build /app/node_modules ./node_modules/

# Copy Prisma schema (needed for prisma migrate deploy)
COPY prisma ./prisma/

# Copy compiled JS
COPY --from=build /app/dist ./dist/

# Copy package.json for module resolution
COPY package.json ./

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Writable temp dir for git clone operations
RUN mkdir -p /tmp/reflex-clones && chown node:node /tmp/reflex-clones

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

USER node

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
