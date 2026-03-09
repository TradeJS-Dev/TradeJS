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
- `npx @tradejs/cli infra-init` (once per project) + `npx @tradejs/cli infra-up`
- Optional ML gRPC service for ML-enabled flows

## 1. Create Project and Install Packages

```bash
mkdir tradejs-project
cd tradejs-project
npm init -y
npm i @tradejs/core @tradejs/cli
```

## 2. Add `tradejs.config.ts`

```ts
import { defineConfig } from '@tradejs/core';

export default defineConfig({
  strategyPlugins: [],
  indicatorsPlugins: [],
});
```

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

## 7. Stop Dev Infra

```bash
npx @tradejs/cli infra-down
```

## Common Errors

### `ECONNREFUSED 127.0.0.1:6379`

Redis is not reachable from your environment.

### `ECONNREFUSED 127.0.0.1:5432`

PostgreSQL/Timescale is not reachable from your environment.
