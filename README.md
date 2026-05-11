# FantasyFocus

This repository implements the **Fantasy Sports Command Center** product. The full specification — tech stack (§5), architecture (§6), data model, APIs, UX, and build order — lives in **[PLAN.md](./PLAN.md)**. Treat `PLAN.md` as the source of truth for implementation details.

## Monorepo layout

pnpm workspaces (see `pnpm-workspace.yaml`):

| Path                                             | Role                       |
| ------------------------------------------------ | -------------------------- |
| [`services/ingestion/`](./services/ingestion/)   | Sportradar push ingestion  |
| [`services/engine/`](./services/engine/)         | Switching engine           |
| [`services/dispatcher/`](./services/dispatcher/) | Deferred events + delivery |
| [`services/api/`](./services/api/)               | REST + WebSocket server    |
| [`app/`](./app/)                                 | Expo (React Native) client |
| [`shared/`](./shared/)                           | Shared TypeScript types    |

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/) 9.x (`packageManager` is pinned in root `package.json`)

## Commands

From the repo root:

```bash
pnpm install
pnpm typecheck   # TypeScript across workspaces
pnpm lint        # ESLint
pnpm format      # Prettier write
```

Client dev server (after install):

```bash
pnpm --filter @fantasy-focus/app start
```

## Documentation

- **[PLAN.md](./PLAN.md)** — product and engineering specification (read this first).
