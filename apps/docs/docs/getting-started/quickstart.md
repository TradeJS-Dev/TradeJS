---
sidebar_position: 2
title: Quickstart
---

This guide is for external package users (without cloning the TradeJS repo).

## Requirements

- Node.js `20.19+`
- npm/yarn/pnpm
- Docker Desktop (or Docker Engine) installed and running
- Docker Compose plugin available (`docker compose`)

## 1. Create Project and Install Packages

```bash
mkdir tradejs-project
cd tradejs-project
npm init -y
npm i @tradejs/app @tradejs/core @tradejs/node @tradejs/types @tradejs/base @tradejs/cli
```

## 2. Add `tradejs.config.ts`

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset);
```

Plugin import policy:

- import plugin registration from `@tradejs/core/config`
- import browser-safe helpers from public `@tradejs/core/*` subpaths
- import Node runtime helpers from public `@tradejs/node/*` subpaths
- import shared contracts from `@tradejs/types`
- avoid internal aliases (`@utils`, `@types`, `@constants`) and non-public deep imports like `@tradejs/core/src/*` or `@tradejs/node/src/*`

## 3. Initialize Dev Infra Files

`infra-init` creates `docker-compose.dev.yml` in project root once.
If the file already exists, it is preserved and not overwritten.

```bash
npx @tradejs/cli infra-init
```

## 4. Start Dev Infra

`infra-up` uses existing `docker-compose.dev.yml` and starts:

- PostgreSQL/Timescale (`127.0.0.1:5432`)
- Redis (`127.0.0.1:6379`)

```bash
npx @tradejs/cli infra-up
```

Note:

- `docker-compose.dev.yml` is for local development infra.
- `docker-compose.prod.yml` is production deployment compose and is not used by `infra-up`.

## 5. Verify Environment

```bash
npx @tradejs/cli doctor
```

Typical endpoints expected by runtime:

- PostgreSQL/Timescale: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`
- ML gRPC (optional): `127.0.0.1:50051`

## 6. Daily Commands

```bash
npx @tradejs/cli signals
npx @tradejs/cli backtest
npx @tradejs/cli results
npx @tradejs/cli bot
```

## 7. Create Root User

TradeJS app and CLI use the `root` user by default.
Create it once before opening the UI:

```bash
npx @tradejs/cli user-add -u root -p 'StrongPassword123!'
```

For details, see [Root User Setup](./root-user).

## 8. Run Web UI

```bash
npx tradejs-app dev
```

Open:

- `http://localhost:3000/routes/backtest` for saved backtest runs
- `http://localhost:3000/routes/dashboard` for market charts and signals

For production mode:

```bash
npx tradejs-app build
npx tradejs-app start
```

## 9. Stop Dev Infra

```bash
npx @tradejs/cli infra-down
```

## Common Errors

### `ECONNREFUSED 127.0.0.1:6379`

Redis is not reachable from your environment.

### `ECONNREFUSED 127.0.0.1:5432`

PostgreSQL/Timescale is not reachable from your environment.
