# syntax=docker/dockerfile:1
# T-062 / DEC-020: the application as a self-hosted Node.js container (Next.js standalone output, started
# with `node server.js`, i.e. `next start` semantics). Multi-stage, non-root, health-checked on /healthz.
#
# Build (APP_ORIGIN is REQUIRED: the static marketing pages bake the gerai application's absolute origin at
# build time, src/lib/hosts.ts, so an image belongs to one environment):
#   docker build --build-arg APP_ORIGIN=https://app.geraiexpress.com -t geraiexpress:<tag> .
# No secret and no .env* file ever enters the image (.dockerignore); configuration is the container
# environment at run time (compose.yaml `env_file`).

# Node 24 LTS line (README: Node 24). Pinned by tag AND digest of the multi-arch index (resolved from the
# local image store on 2026-10-29, tag node:24.21.0-bookworm-slim); bump both together.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps
# pnpm comes from package.json "packageManager" through corepack (no global install, no version drift).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: nothing in the image build or runtime needs install scripts (sharp and esbuild ship
# prebuilt platform packages), so a dependency's postinstall never runs inside the build.
RUN corepack enable
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
ARG APP_ORIGIN
COPY . .
# `public` can be empty after removing the obsolete edge-host `_headers` file.
RUN mkdir -p public
# The browser bundle is scanned for server-only secrets before the image can exist.
RUN test -n "$APP_ORIGIN" || { echo "APP_ORIGIN build argument is required (the gerai application's https origin)" >&2; exit 1; } \
 && APP_ORIGIN="$APP_ORIGIN" pnpm build \
 && node scripts/check-client-bundle.mjs

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Root owns the executable code: the app user may write its cache only, never server.js or node_modules.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The scheduler sidecar runs from this same image (compose.yaml: `node scheduler.mjs`).
COPY infra/scheduler/scheduler.mjs ./scheduler.mjs
RUN mkdir -p /app/.next/cache && chown node:node /app/.next/cache
USER node
EXPOSE 3000
# /healthz is served on every allowed host, including this non-public internal name (no shared-mode flag needed).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "require('node:http').get({host:'127.0.0.1',port:process.env.PORT,path:'/healthz',headers:{host:'internal.geraiexpress.local'}},(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "server.js"]
