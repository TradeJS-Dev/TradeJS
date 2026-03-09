---
sidebar_position: 2
title: Quickstart
---

This guide is for external package users (without cloning the TradeJS repo).

## Requirements

- Node.js `20.19+`
- npm/yarn/pnpm
- Running Redis and PostgreSQL/Timescale
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

## 3. Verify Environment

```bash
npx @tradejs/cli doctor
```

Typical endpoints expected by runtime:

- PostgreSQL/Timescale: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`
- ML gRPC (optional): `127.0.0.1:50051`

## 4. Daily Commands

```bash
npx @tradejs/cli signals
npx @tradejs/cli backtest
npx @tradejs/cli results
npx @tradejs/cli bot
```

## Common Errors

### `ECONNREFUSED 127.0.0.1:6379`

Redis is not reachable from your environment.

### `ECONNREFUSED 127.0.0.1:5432`

PostgreSQL/Timescale is not reachable from your environment.
