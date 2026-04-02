# TradeJS

TradeJS is an open-source framework for TypeScript and Pine Script strategy authoring, backtesting, live signal generation, and optional auto-trading.

It supports two first-class authoring paths:

- TypeScript strategies built with `StrategyAPI`
- Pine Script strategies embedded as standalone strategy modules (with a separate `.pine` source file)

## Public Resources

### Web

- Site: [tradejs.dev](https://tradejs.dev)
- Documentation: [docs.tradejs.dev](https://docs.tradejs.dev)
- Site repo: [TradeJS-Dev/tradejs-site](https://github.com/TradeJS-Dev/tradejs-site)
- Docs repo: [TradeJS-Dev/tradejs-docs](https://github.com/TradeJS-Dev/tradejs-docs)
- npm organization: [npmjs.com/org/tradejs](https://www.npmjs.com/org/tradejs)

### Published npm Packages

- [`@tradejs/app`](https://www.npmjs.com/package/@tradejs/app) — installable Next.js UI for dashboards, backtests, and runtime data
- [`@tradejs/cli`](https://www.npmjs.com/package/@tradejs/cli) — official CLI for infra setup, backtests, signals, bots, and AI/ML workflows
- [`@tradejs/base`](https://www.npmjs.com/package/@tradejs/base) — default preset wiring built-in strategies, indicators, and connectors
- [`@tradejs/core`](https://www.npmjs.com/package/@tradejs/core) — browser-safe public API for config, strategy authoring, indicators, and shared helpers
- [`@tradejs/node`](https://www.npmjs.com/package/@tradejs/node) — Node runtime for strategies, backtests, Pine loading, and plugin registries
- [`@tradejs/types`](https://www.npmjs.com/package/@tradejs/types) — shared TypeScript contracts for the TradeJS ecosystem
- [`@tradejs/infra`](https://www.npmjs.com/package/@tradejs/infra) — server-only adapters for Redis, Timescale, ML, logging, and IO
- [`@tradejs/strategies`](https://www.npmjs.com/package/@tradejs/strategies) — built-in strategy plugin catalog
- [`@tradejs/indicators`](https://www.npmjs.com/package/@tradejs/indicators) — built-in indicator plugin catalog
- [`@tradejs/connectors`](https://www.npmjs.com/package/@tradejs/connectors) — built-in exchange connectors and market data providers

## Repository Layout

- `apps/app`: Next.js UI and API
- `packages/core`: browser-safe public API, shared helpers, plugin config API
- `packages/node`: Node-only runtime, plugin loading, backtest/pine execution helpers
- `packages/strategies`: built-in strategy plugin package
- `packages/indicators`: built-in indicators package
- `packages/base`: default preset that wires built-in strategies/indicators/connectors
- `packages/connectors`: exchange connectors and market data providers
- `packages/cli`: operational scripts (`backtest`, `signals`, `results`, `ai-*`, `ml-*`, `doctor`, etc.)
- `packages/ml/python`: Python train/infer/profile services
- `examples/sandbox`: full user-app style sandbox with local `tradejs.config.ts`, custom strategy/indicator/connector plugins, and deterministic backtest/signals e2e flow

Public web surfaces are now maintained in separate repositories:

- `tradejs-site` for `tradejs.dev`
- `tradejs-docs` for `docs.tradejs.dev`

This monorepo no longer contains the source code for those public web surfaces.

## Core Concepts

### Shared Runtime

All strategies run through the shared runtime in:

- `packages/node/src/strategyRuntime.ts`

Strategy `core.ts` returns one of:

- `skip`
- `entry`
- `exit`

Runtime then handles:

- signal construction and enrichment
- optional ML/AI gating
- order execution and hook invocation

`strategyApi.entry(...)` contract is minimal:

- strategy passes `direction` and `orderPlan` (`qty`, `stopLossPrice`, `takeProfits`)
- strategy may pass optional `code`; if omitted, runtime auto-generates it
- shared runtime resolves signal `timestamp/currentPrice/takeProfitPrice/riskRatio`

### Strategy Registration

Strategies are loaded as plugins via manifests and registry:

- `packages/node/src/strategy/manifests.ts`
- `packages/strategies/src/*/manifest.ts`

### Pine Strategy Support

Pine strategies are stored as normal strategy modules and keep Pine source in a dedicated file:

- `packages/strategies/src/<Strategy>/<strategy>.pine`

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

Useful routes:

- `http://localhost:3000/routes/backtest` — saved backtest runs and detail pages
- `http://localhost:3000/routes/dashboard` — chart view for signals and market inspection

## Common Commands

```bash
yarn build:ci
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

## AI Flow (Offline Prompt Replay)

1. `yarn backtest --AI` writes per-worker AI prompt chunks to `data/ai/export/ai-dataset-<strategy>-chunk-<chunkId>.jsonl`.
2. `yarn ai-export` merges chunks to `data/ai/export/ai-dataset-<strategy>-merged-<timestamp>.jsonl`.
3. `yarn ai-train -n 50 --minQuality 4` replays saved prompts through AI and prints approval/accuracy stats.
4. `-n 0` evaluates all rows from the merged dataset instead of only the latest sample from the end.
5. `ai-train` treats a trade as AI-approved when returned `direction` matches the original signal direction and `quality >= minQuality`.

## Plugin Configuration

Create `tradejs.config.ts` at repository root:

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset, {
  strategies: ['@scope/my-strategy-plugin'],
  indicators: ['@scope/my-indicator-plugin'],
  connectors: ['@scope/my-connector-plugin'],
});
```

Import policy for plugin code:

- import plugin registration from `@tradejs/core/config`
- import runtime/helpers from explicit public subpaths like `@tradejs/node/strategies`, `@tradejs/node/backtest`, `@tradejs/core/indicators`, `@tradejs/core/math`, `@tradejs/core/time`, `@tradejs/node/pine`
- import shared types from `@tradejs/types`
- do not use non-public deep imports

Utils convention for contributors:

- keep browser-safe helpers in `packages/core/src/*`
- keep node-only runtime orchestration in `packages/node/src/*`
- keep infra adapters in `packages/infra/src/*`
- keep test-only helpers in `packages/core/src/utils/testHelpers/*`
- avoid duplicated helper implementations in runtime files

Expected plugin exports:

- strategy plugin: `strategyEntries`
- indicator plugin: `indicatorEntries`
- connector plugin: `connectorEntries`

Sandbox deterministic e2e example:

```bash
yarn sandbox:install
yarn sandbox:infra-up
yarn sandbox:e2e
yarn sandbox:infra-down
```

`yarn sandbox:install` updates the published `@tradejs/*` packages used by `examples/sandbox` within the allowed semver ranges before installing them.

## Documentation

Public documentation now lives in the standalone repository:

- [TradeJS-Dev/tradejs-docs](https://github.com/TradeJS-Dev/tradejs-docs)

Public marketing site now lives in:

- [TradeJS-Dev/tradejs-site](https://github.com/TradeJS-Dev/tradejs-site)

Use this monorepo README only for internal repository workflows.

## AI Discovery Surface

Public web surfaces expose AI-oriented discovery files:

- `tradejs-site/public/llms.txt` in `TradeJS-Dev/tradejs-site`
- `tradejs-site/public/llms-full.txt` in `TradeJS-Dev/tradejs-site`
- `tradejs-docs/static/llms.txt` in `TradeJS-Dev/tradejs-docs`
- `tradejs-docs/static/llms-full.txt` in `TradeJS-Dev/tradejs-docs`

Keep these files aligned with:

- current package boundaries
- current public entrypoints
- current canonical docs URLs
