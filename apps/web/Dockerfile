# syntax=docker/dockerfile:1
FROM node:26.5.0-alpine AS base
WORKDIR /m

ENV CI=true \
    HOME=/root
RUN npm install -g pnpm@11.9.0 \
    && mkdir -p /pnpm/store \
    && printf 'store-dir=/pnpm/store\n' > /root/.npmrc

FROM base AS dev
ARG LOCAL_UID=1000
ARG LOCAL_GID=1000

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile
ENV HOME=/home/app \
    PNPM_HOME=/home/app/.pnpm \
    XDG_DATA_HOME=/home/app/.local/share \
    XDG_CACHE_HOME=/home/app/.cache \
    XDG_CONFIG_HOME=/home/app/.config
# Only generated output and caches are writable; source binds stay read-only.
RUN mkdir -p /home/app/store /m/apps/web/config /m/apps/web/data /m/packages/config/dist /m/packages/analytics/dist /m/packages/db/dist /m/apps/web/.svelte-kit \
        '/m/apps/web/node_modules/$app' \
        /m/apps/web/node_modules/.vite /m/apps/web/node_modules/.vite-temp \
    && printf 'store-dir=/home/app/store\n' > /home/app/.npmrc \
    && chown -R ${LOCAL_UID}:${LOCAL_GID} /home/app /m/apps/web/data /m/packages/config/dist /m/packages/analytics/dist /m/packages/db/dist \
        /m/apps/web/.svelte-kit '/m/apps/web/node_modules/$app' \
        /m/apps/web/node_modules/.vite /m/apps/web/node_modules/.vite-temp
USER ${LOCAL_UID}:${LOCAL_GID}
WORKDIR /m/apps/web
EXPOSE 5173
CMD ["sh", "-c", "pnpm -r --filter @goto/config --filter @goto/db... build && exec node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort"]

FROM base AS builder

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter "@goto/web..." build

FROM builder AS pruner

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --config.hoist-workspace-packages=false --filter @goto/web --prod deploy --legacy /pruned \
    && mkdir -p /pruned/node_modules

FROM node:26.5.0-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
COPY --from=pruner /pruned/build /app/build
COPY --from=pruner /pruned/server.js /app/server.js
COPY --from=pruner /pruned/node_modules /app/node_modules
COPY --from=pruner /pruned/package.json /app/package.json
RUN mkdir -p /app/config /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "/app/server.js"]
