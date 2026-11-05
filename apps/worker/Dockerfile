# syntax=docker/dockerfile:1
FROM node:26.5.0-alpine AS base
WORKDIR /m

ENV CI=true \
    HOME=/home/app \
    PNPM_HOME=/home/app/.pnpm \
    XDG_DATA_HOME=/home/app/.local/share \
    XDG_CACHE_HOME=/home/app/.cache \
    XDG_CONFIG_HOME=/home/app/.config
RUN npm install -g pnpm@11.9.0 \
    && mkdir -p /home/app/store \
    && printf 'store-dir=/home/app/store\n' > /home/app/.npmrc

FROM base AS dev
ARG LOCAL_UID=1000
ARG LOCAL_GID=1000

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm install --offline --frozen-lockfile
RUN mkdir -p /m/apps/worker/config /m/apps/worker/data /m/packages/config/dist \
    && chown -R ${LOCAL_UID}:${LOCAL_GID} /home/app /m/apps/worker/data /m/packages/config/dist
USER ${LOCAL_UID}:${LOCAL_GID}
WORKDIR /m/apps/worker
EXPOSE 9000
CMD ["pnpm", "run", "dev"]

FROM base AS builder
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter "@goto/worker..." build

FROM builder AS pruner
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store \
    pnpm --config.hoist-workspace-packages=false --filter @goto/worker --prod deploy --legacy /pruned

FROM node:26.5.0-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production \
    PORT=9000 \
    HOST=0.0.0.0
COPY --from=pruner /pruned/dist /app/dist
COPY --from=pruner /pruned/node_modules /app/node_modules
COPY --from=pruner /pruned/package.json /app/package.json
RUN mkdir -p /app/config /app/data && chown node:node /app/data
USER node
EXPOSE 9000
CMD ["node", "/app/dist/index.js"]
