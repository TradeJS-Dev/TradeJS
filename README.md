# TradeJS

TradeJS is an open-source framework for TypeScript and Pine Script strategy authoring, backtesting, live signal generation, and optional auto-trading.

It supports two first-class authoring paths:

- TypeScript strategies built with `StrategyAPI`
- Pine Script strategies embedded as standalone strategy modules (with a separate `.pine` source file)

## Public Resources

### Web

- Site: [tradejs.dev](https://tradejs.dev)
- Documentation: [docs.tradejs.dev](https://docs.tradejs.dev)
- Site repo: [TradeJS-Dev/TradeJS-Site](https://github.com/TradeJS-Dev/TradeJS-Site)
- Docs repo: [TradeJS-Dev/TradeJS-Docs](https://github.com/TradeJS-Dev/TradeJS-Docs)
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

- `TradeJS-Site` for `tradejs.dev`
- `TradeJS-Docs` for `docs.tradejs.dev`

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

`createStrategyRuntime` provides `loadPineScriptFile(...)` to strategy core via `CreateStrategyCore` params.

### Indicator Architecture

Shared indicator pipeline lives in:

- `packages/core/src/utils/indicators.ts`

Plugin indicators are registered via indicator entries and can add:

- compute series
- optional figure renderers

## Quick Start

### 1. Prerequisites

- Node.js `24.17.0` (see `.nvmrc`)
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
yarn signals:daemon -- --notify --makeOrders
yarn signals:summary -- --printOnly
yarn bot
```

Data refresh and integrity:

```bash
yarn update-history -- --user root --config TrendLine:base --connector bybit --timeframe 15
yarn continuity --user root --timeframe 15 --provider bybit
```

## Telegram Notifications

- Telegram bot credentials are configured per user via `TG_BOT_TOKEN` and `TG_CHAT_ID` in the app settings drawer.
- `yarn signals -- --notify` sends runtime signal notifications; `skipped` and `canceled` signals are filtered out and not delivered to Telegram.
- `yarn signals:daemon -- --notify --makeOrders` keeps bounded StrategyAPI detector state between closed candles while disposing each heavy runtime and indicator controller after evaluation. It rebuilds state from the rolling warmup window after a restart, candle gap, config change, or bounded-history limit. Production caps its Node heap at `SIGNALS_DAEMON_HEAP_MB` (4096 MB by default) and logs RSS/heap usage after every cycle.
- The Bybit signals daemon uses one persistent public kline WebSocket by default. Confirmed candles are batch-upserted into Timescale; REST remains the automatic startup, missing-candle, and reconnect recovery path. Set `SIGNALS_KLINE_WS_ENABLED=0` for an immediate REST-only rollback or tune the close wait with `SIGNALS_KLINE_WS_WAIT_MS`.
- Production also starts `yarn market:ws` on `MARKET_WS_PORT=3001`. The dashboard loads history over HTTP, then receives live/forming candles through `/ws/market` without opening browser connections to Bybit.
- Each signal is delivered in order with its optional AI analysis follow-up so chat ordering stays stable.
- `yarn signals:summary` builds the Telegram digest; current cron sends the daily report every day at `21:00` in `Europe/Moscow` timezone for the last 24 hours and the weekly report on Sundays at `22:10` for the last 168 hours. Runtime parity runs every day at `21:10` in `Europe/Moscow` timezone.
- The summary groups signal statuses and trade PnL/status by strategy and uses generated runtime `orderId` linkage (`orderLinkId` on Bybit).

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

`yarn sandbox:install` is deterministic and installs `examples/sandbox` from its
committed lockfile.

If you intentionally want to refresh the published `@tradejs/*` packages used by
the sandbox, run:

```bash
yarn sandbox:refresh
```

## Documentation

Public documentation now lives in the standalone repository:

- [TradeJS-Dev/TradeJS-Docs](https://github.com/TradeJS-Dev/TradeJS-Docs)

Public marketing site now lives in:

- [TradeJS-Dev/TradeJS-Site](https://github.com/TradeJS-Dev/TradeJS-Site)

Use this monorepo README only for internal repository workflows.

## AI Discovery Surface

Public web surfaces expose AI-oriented discovery files:

- `TradeJS-Site/public/llms.txt` in `TradeJS-Dev/TradeJS-Site`
- `TradeJS-Site/public/llms-full.txt` in `TradeJS-Dev/TradeJS-Site`
- `TradeJS-Docs/static/llms.txt` in `TradeJS-Dev/TradeJS-Docs`
- `TradeJS-Docs/static/llms-full.txt` in `TradeJS-Dev/TradeJS-Docs`

Keep these files aligned with:

- current package boundaries
- current public entrypoints
- current canonical docs URLs
