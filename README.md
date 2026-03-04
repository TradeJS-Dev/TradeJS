# TradeJS

TradeJS is a monorepo framework for strategy development, backtesting, live signal generation, and optional auto-trading.

It supports two first-class authoring paths:

- TypeScript strategies built with `StrategyAPI`
- Pine Script strategies embedded as standalone strategy modules (with a separate `.pine` source file)

## Repository Layout

- `apps/app`: Next.js UI and API
- `apps/docs`: Docusaurus documentation
- `packages/core`: strategy runtime, strategy implementations, shared types/helpers
- `packages/connectors`: exchange connectors and market data providers
- `packages/cli`: operational scripts (`backtest`, `signals`, `results`, `ml-*`, `doctor`, etc.)
- `packages/framework`: public framework entrypoint for external strategy/indicator plugins
- `packages/ml/python`: Python train/infer/profile services
- `examples/sandbox`: reference strategy/indicator plugin package

## Core Concepts

### Shared Runtime

All strategies run through the shared runtime in:

- `packages/core/src/utils/strategyRuntime.ts`

Strategy `core.ts` returns one of:

- `skip`
- `entry`
- `exit`

Runtime then handles:

- signal construction and enrichment
- optional ML/AI gating
- order execution and hook invocation

### Strategy Registration

Built-in and plugin strategies are resolved via manifests and registry:

- `packages/core/src/strategy/manifests.ts`
- `packages/core/src/strategy/*/manifest.ts`

### Pine Strategy Support

Pine strategies are stored as normal strategy modules and keep Pine source in a dedicated file:

- `packages/core/src/strategy/<Strategy>/<strategy>.pine`

`createStrategyRuntime` provides `loadPineScript(...)` to strategy core via `CreateStrategyCore` params.

### Indicator Architecture

Shared indicator pipeline lives in:

- `packages/core/src/utils/indicators.ts`

Plugin indicators are registered via indicator entries and can add:

- compute series
- optional figure renderers

## Quick Start

### 1. Prerequisites

- Node.js `20.19.6` (see `.nvmrc`)
- Yarn `4.x`
- Docker + Docker Compose

### 2. Install

```bash
corepack enable
nvm use
yarn
```

### 3. Start Infra

```bash
yarn infra-up
yarn doctor
```

### 4. Run App

```bash
yarn dev
```

Open `http://localhost:3000`.

## Common Commands

```bash
yarn backtest
yarn results
yarn signals
yarn bot
```

Data refresh and integrity:

```bash
yarn update-history -- --user root --config TrendLine:base --connector bybit --timeframe 15
yarn continuity --user root --timeframe 15 --provider bybit
```

## ML Flow (High-Level)

1. Backtest can write per-worker ML chunks.
2. `yarn ml-export` merges chunks to JSONL export.
3. `yarn ml-train:latest` (or model-specific scripts) prepares holdout/prod/walk-forward splits and trains.
4. `yarn ml-upload:prod` uploads inference aliases.
5. Runtime inference uses gRPC (`ML_GRPC_ADDRESS`) when enabled.

## Plugin Configuration

Create `tradejs.config.ts` at repository root:

```ts
import { defineConfig } from '@tradejs/framework';

export default defineConfig({
  strategyPlugins: ['@scope/my-strategy-plugin'],
  indicatorsPlugins: ['@scope/my-indicator-plugin'],
});
```

Expected plugin exports:

- strategy plugin: `strategyEntries`
- indicator plugin: `indicatorEntries`

## Documentation

Run local docs:

```bash
yarn docs:dev
```

Build docs:

```bash
yarn docs:build
```

Recommended docs sections:

- `strategies/*`
- `runtime/*`
- `indicators/*`
- `ml/*`
- `operations/*`
