# TradeJS

TradeJS is a monorepo framework for strategy development, backtesting, live signal generation, and optional auto-trading.

It supports two first-class authoring paths:

- TypeScript strategies built with `StrategyAPI`
- Pine Script strategies embedded as standalone strategy modules (with a separate `.pine` source file)

## Repository Layout

- `apps/app`: Next.js UI and API
- `apps/docs`: Docusaurus documentation
- `packages/core`: shared runtime, public types, plugin config API
- `packages/strategies`: built-in strategy plugin package
- `packages/indicators`: built-in indicators package
- `packages/base`: default preset that wires built-in strategies/indicators/connectors
- `packages/connectors`: exchange connectors and market data providers
- `packages/cli`: operational scripts (`backtest`, `signals`, `results`, `ml-*`, `doctor`, etc.)
- `packages/ml/python`: Python train/infer/profile services
- `examples/sandbox`: full user-app style sandbox with local `tradejs.config.ts`, custom strategy/indicator/connector plugins, and deterministic backtest/signals e2e flow

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

`strategyApi.entry(...)` contract is minimal:

- strategy passes `direction` and `orderPlan` (`qty`, `stopLossPrice`, `takeProfits`)
- strategy may pass optional `code`; if omitted, runtime auto-generates it
- shared runtime resolves signal `timestamp/currentPrice/takeProfitPrice/riskRatio`

### Strategy Registration

Strategies are loaded as plugins via manifests and registry:

- `packages/core/src/strategy/manifests.ts`
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
- import runtime/helpers from explicit public subpaths like `@tradejs/core/strategies`, `@tradejs/core/indicators`, `@tradejs/core/backtest`, `@tradejs/core/math`, `@tradejs/core/time`, `@tradejs/core/pine`
- import shared types from `@tradejs/types`
- do not use internal aliases like `@utils` / `@constants`
- do not use non-public deep imports

Utils convention for contributors:

- keep production runtime utilities in `packages/core/src/utils/*` and `packages/infra/src/*`
- keep test-only helpers in `packages/core/src/utils/testHelpers/*`
- avoid duplicated helper implementations in runtime files

Expected plugin exports:

- strategy plugin: `strategyEntries`
- indicator plugin: `indicatorEntries`
- connector plugin: `connectorEntries`

Sandbox deterministic e2e example:

```bash
cd examples/sandbox
yarn infra-up
yarn e2e
yarn infra-down
```

## Documentation

Run local docs:

```bash
yarn docs:dev
```

Build docs:

```bash
yarn docs:build
```

Deploy docs on `https://docs.tradejs.dev`:

```bash
docker compose -f docker-compose.prod.yml build docs
docker compose -f docker-compose.prod.yml up -d app redis docs nginx certbot-cron
docker compose -f docker-compose.prod.yml run --rm certbot
docker compose -f docker-compose.prod.yml restart nginx
```

SSL verification:

```bash
echo | openssl s_client -connect 92.63.100.27:443 -servername docs.tradejs.dev 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

The certificate SAN must include `DNS:docs.tradejs.dev`.

Recommended docs sections:

- `strategies/*`
- `runtime/*`
- `indicators/*`
- `ml/*`
- `operations/*`
