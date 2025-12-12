# syntax=docker/dockerfile:1

FROM node:20-slim AS base
WORKDIR /app

# Install dependencies for puppeteer/chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell puppeteer to use system chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ── Install all dependencies (dev + prod) for build ──
FROM base AS deps
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Build TypeScript ──
FROM deps AS build
COPY tsconfig.json tsconfig.json
COPY src ./src
COPY scripts ./scripts
RUN pnpm build

# ── Prune to production dependencies only ──
FROM deps AS prod-deps
RUN pnpm prune --prod

# ── Final runtime image ──
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package.json

EXPOSE 8080
CMD ["node", "dist/index.js"]

