# ── deps: full dependency install (build needs devDependencies) ──────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder: Next.js production build + runtime tree assembly ────────────────
FROM deps AS builder
COPY . .
RUN npm run build
# Assembles /runtime: standalone server + static + public + the
# @stellar/stellar-sdk dependency closure (see scripts/docker-external-deps.js)
RUN node scripts/docker-external-deps.js

# ── runner: minimal non-root production image ────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# node:alpine ships a non-root `node` user (UID/GID 1000)
COPY --from=builder --chown=node:node /runtime ./
USER node

EXPOSE 3000
CMD ["node", "server.js"]
