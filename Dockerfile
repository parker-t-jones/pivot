# Multi-stage image for @pivot/api (+ workspace deps) on Fly.
# Build: docker build -t pivot-api .
# Never COPY .env* — secrets come from `fly secrets`.

FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Lockfile + manifests first for better layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.build.json ./
COPY shared/package.json shared/tsconfig.json ./shared/
COPY services/engine/package.json services/engine/tsconfig.json ./services/engine/
COPY services/dispatcher/package.json services/dispatcher/tsconfig.json ./services/dispatcher/
COPY services/api/package.json services/api/tsconfig.json ./services/api/
COPY services/ingestion/package.json services/ingestion/tsconfig.json ./services/ingestion/

RUN pnpm install --frozen-lockfile

COPY shared ./shared
COPY services/engine ./services/engine
COPY services/dispatcher ./services/dispatcher
COPY services/api ./services/api
COPY services/ingestion ./services/ingestion

RUN pnpm exec tsc -b tsconfig.build.json

# Portable production tree: api + resolved @pivot/* workspace packages + prod node_modules.
RUN pnpm --filter=@pivot/api deploy --prod /out

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}

COPY --from=build /out ./

# Default process is the API; Fly process groups override for the worker.
EXPOSE 3000
CMD ["node", "dist/index.js"]
