# syntax=docker/dockerfile:1
FROM node:26.5.0-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS builder
WORKDIR /m

ENV CI=true
RUN npm install -g pnpm@11.9.0 \
    && pnpm config set store-dir /pnpm/store

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter "@goto/cli..." build

FROM node:26.5.0-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS prod
WORKDIR /app

ENV NODE_ENV=production
COPY --from=builder /m/apps/cli/dist/index.js /app/goto-cli.js
RUN mkdir -p /app/config
USER node
ENTRYPOINT ["node", "/app/goto-cli.js"]
