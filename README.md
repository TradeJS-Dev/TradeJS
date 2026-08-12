# TradeJS

TradeJS is a TypeScript framework for strategy authoring, backtesting, live signal generation, and optional auto-trading, with a self-hosted runtime you control.

It supports two first-class authoring paths:

- TypeScript strategies built with `StrategyAPI`
- Pine Script strategies embedded as standalone strategy modules (with a separate `.pine` source file)

## TradeJS in Action

[![TradeJS chart with strategy entries, exits, take profit, stop loss, and trend lines](.github/assets/strategy-chart.webp)](https://tradejs.dev)

[![TradeJS runtime dashboard with strategy performance, drawdown, orders, and win rate](.github/assets/runtime-performance.webp)](https://tradejs.dev)

## Public Resources

### Web

- Site: [tradejs.dev](https://tradejs.dev)
- Documentation: [docs.tradejs.dev](https://docs.tradejs.dev)
- Questions and feedback: [t.me/aleksnick](https://t.me/aleksnick)
- Site repo: [TradeJS-Dev/TradeJS-Site](https://github.com/TradeJS-Dev/TradeJS-Site)
- Docs repo: [TradeJS-Dev/TradeJS-Docs](https://github.com/TradeJS-Dev/TradeJS-Docs)
- Discussions: [GitHub Discussions](https://github.com/TradeJS-Dev/TradeJS/discussions)
- npm organization: [npmjs.com/org/tradejs](https://www.npmjs.com/org/tradejs)

### Published npm Packages

- [`create-tradejs`](https://www.npmjs.com/package/create-tradejs) — one-command external project, infrastructure, login, and first-backtest UI bootstrap
- [`@tradejs/app`](https://www.npmjs.com/package/@tradejs/app) — installable Next.js UI for dashboards, backtests, and runtime data
- [`@tradejs/cli`](https://www.npmjs.com/package/@tradejs/cli) — official CLI for infra setup, backtests, signals, bots, and AI/ML workflows
- [`@tradejs/base`](https://www.npmjs.com/package/@tradejs/base) — default preset wiring built-in strategies, indicators, and connectors
- [`@tradejs/core`](https://www.npmjs.com/package/@tradejs/core) — browser-safe public API for config, strategy authoring, indicators, and shared helpers
- [`@tradejs/node`](https://www.npmjs.com/package/@tradejs/node) — Node runtime for strategies, backtests, Pine strategy loading, and plugin registries
- [`@tradejs/types`](https://www.npmjs.com/package/@tradejs/types) — shared TypeScript contracts for the TradeJS ecosystem
- [`@tradejs/infra`](https://www.npmjs.com/package/@tradejs/infra) — server-only adapters for Redis, Timescale, ML, logging, and IO
- [`@tradejs/strategies`](https://www.npmjs.com/package/@tradejs/strategies) — built-in strategy plugin catalog
- [`@tradejs/indicators`](https://www.npmjs.com/package/@tradejs/indicators) — built-in indicator plugin catalog
- [`@tradejs/connectors`](https://www.npmjs.com/package/@tradejs/connectors) — built-in exchange connectors and market data providers

## Licensing

TradeJS version 2.0.0 and later uses a mixed-license open-core model:

- product components (`@tradejs/app`, `@tradejs/base`, `@tradejs/cli`,
  `@tradejs/node`, `@tradejs/strategies`, and the private ML runtime) use the
  Business Source License 1.1 with an Additional Use Grant
- SDK, integration, scaffolding, and example components (`@tradejs/core`,
  `@tradejs/types`, `@tradejs/indicators`, `@tradejs/connectors`,
  `@tradejs/infra`, `create-tradejs`, and `examples/sandbox`) remain under MIT

The Additional Use Grant permits production use, including internal trading,
research, analytics, and operations. Providing a competing product or hosted
or managed service requires a commercial license. Releases through version
1.0.12 remain available under MIT. See [LICENSING.md](LICENSING.md) for exact
package scopes and terms.

## Repository Layout

- `apps/app`: Next.js UI and API
- `packages/core`: browser-safe public API, shared helpers, plugin config API
- `packages/node`: Node-only runtime, plugin loading, backtest/pine execution helpers
- `packages/strategies`: built-in strategy plugin package
- `packages/indicators`: built-in indicators package
- `packages/base`: default preset that wires built-in strategies/indicators/connectors
- `packages/connectors`: exchange connectors and market data providers
- `packages/cli`: operational scripts (`backtest`, `signals`, `results`, `ai-*`, `ml-*`, `doctor`, etc.)
- `packages/create-tradejs`: external project generator and first-backtest bootstrap
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

Each strategy plugin exports a declarative entry with `manifest`, `defaults`,
and `createCore`. The Node registry turns that definition into a server runtime;
strategy packages do not construct or import the Node runtime themselves.

### Pine Strategy Support

Pine strategies are stored as normal strategy modules and keep Pine source in a dedicated file:

- `packages/strategies/src/<Strategy>/<strategy>.pine`

Pine file loading and execution are explicit server-side operations exposed by
`@tradejs/node/pine`. They are not injected into the browser-safe
`CreateStrategyCore` contract.

Pine support currently applies only to strategy modules. Custom indicator plugins must be authored in TypeScript; standalone Pine indicator plugins are not supported.

### Indicator Architecture

Shared indicator pipeline lives in:

- `packages/core/src/utils/indicators.ts`

Plugin indicators are registered via indicator entries and can add:

- compute series
- optional figure renderers

## Strategy Development And Research

Treat strategy implementation, raw-core research, AI-gate research, and live
deployment as four separate stages. A profitable gate cannot repair an invalid
or non-causal core experiment, and a promising backtest is not permission to
place orders.

### 1. Implement A Replay-Safe Strategy

Built-in strategies live under `packages/strategies/src/<StrategyName>`:

- keep deterministic detector transitions in a replayable `engine.ts` when the
  strategy has pivots, pending confirmations, zones, or other rolling state
- keep position checks, cooldowns, risk sizing, and `entry`/`exit` decisions in
  `core.ts`
- put defaults and typed parameters in `config.ts`; new research behavior should
  normally be default-off so the control remains reproducible
- add deterministic `figures` for geometry that must be inspected on a chart
- cover the legacy control, candidate behavior, LONG and SHORT, duplicate
  timestamps, continuous replay versus `initialCandles`, and config-state
  isolation with unit tests

The complete runtime contract and examples are in [STRATEGY_API.md](STRATEGY_API.md).
Run the focused strategy suite before starting a costly experiment:

```bash
yarn jest packages/strategies/src/<StrategyName> --runInBand
yarn workspace @tradejs/strategies typecheck
```

### 2. Preregister The Raw-Core Experiment

Use `yarn research:core` for control-versus-candidate research. Freeze the
causal claim, ordered universe and checksum, exact half-open UTC window,
resolved configs and their canonical hashes, fees/slippage/entry delay, target
direction, selection rules, and experiment stage before running anything.

```bash
yarn research:core init \
  --out data/research/specs/my-hypothesis.json \
  --researchId my-strategy-family-v1 \
  --strategy MyStrategy \
  --start <epoch-ms> \
  --end <epoch-ms> \
  --symbolsFile data/research/frozen-symbols.json

# Fill causalClaim, stage, variants[].resolvedConfig/configSha256,
# commands or files, and executable selection rules in the generated spec.
yarn research:core prepare --spec data/research/specs/my-hypothesis.json
yarn research:core run --spec data/research/specs/my-hypothesis.json
yarn research:core verify --spec data/research/specs/my-hypothesis.json
yarn research:core index --root data/research/core
```

Use `analyze` instead of `run` when the spec points to already completed,
explicit exports. `--researchTrace` is opt-in and should be used only when the
question needs setup/entry/skip funnel attribution.

The standard evidence progression is:

1. a bounded all-universe `screen` for selection
2. an isolated, single-config `isolated_long` run for long-window evidence
3. `confirmation` with non-fast execution, cold-start/reset sensitivity, cost
   and delay stress, and runtime parity where applicable

Every config and window reports fixed `ALL`, `LONG`, and `SHORT` cohorts with
`N`, PnL, PnL/trade, PF, WR, realized MaxDD, and cadence/day. Both directions
remain enabled in the raw-core config. A losing side is evidence to investigate
or gate later, not a result to hide. Aggregate portfolio guardrails and a
direction-targeted causal verdict remain separate.

`yarn backtest --ai` is only raw completed-core-trade transport in this stage;
it does not mean the AI gate approved those trades. Exports are accepted only
after a completed manifest, full checkpoints, explicit run-scoped export, and
Redis-versus-JSONL reconciliation:

```bash
yarn ai-export --strategy MyStrategy --runId <run-id> --partMonths 0 --keepChunks
yarn node -r dotenv/config \
  .codex/skills/strategy-backtest-research/scripts/fast-ai-export-metrics.mjs \
  --file <merged-export.jsonl> --run <run-id> --json
```

The full spec, artifact, statistical, performance, and verification contract is
in [CORE_RESEARCH.md](CORE_RESEARCH.md). Immutable local findings belong in
`notes/<Strategy>/YYYY-MM-DD-<slug>.md`; `notes/` is intentionally ignored and
must never be committed.

### 3. Research The AI Gate Separately

Only after the core candidate has valid evidence should the same immutable
export be used for gate research. Discover causal pockets with a time-ordered
holdout, then replay the deterministic local gate over all selected rows:

```bash
yarn ai-pocket-search --strategy MyStrategy -n 0 --maxDepth 2 --minSupport 25
yarn ai-train --strategy MyStrategy --localOnly -n 0 --minQuality 4 --json
```

Evaluate qN+ streams, terminal windows, regimes, symbols, and LONG/SHORT
separately. Gate inputs must exist at signal time; delayed fills, exit reasons,
and realized PnL are outcomes, never features. `AI_MODE=gate` is comparable to
`ai-train --localOnly`; `AI_MODE=llm` requires provider-backed evidence and must
not inherit local-gate claims.

### 4. Promote And Launch Gradually

Promote only one fully resolved config. Backtest configs are value grids;
runtime configs are plain objects. Review the existing runtime config before
replacing it, keep `ENABLE=true`, retain both LONG and SHORT for AI-gated
deployment, and preserve the tested `AI_ENABLED`, `AI_MODE`, and
`MIN_AI_QUALITY`. Runtime configs can be reviewed and saved from the strategies
screen at `http://localhost:3000/routes/strategies`.

Use an explicit rollout ladder:

```bash
# 1. Build and validate the exact working tree.
yarn checks

# 2. Evaluate one closed-candle cycle without notifications or orders.
yarn signals -- --user root --connector bybit --cacheOnly

# 3. Compare recent replay/backtest entries with recorded runtime evidence.
yarn runtime-parity -- --user root --connector bybit --days 3 --details

# 4. Observe notifications, still without order placement.
yarn signals:daemon -- --user root --connector bybit --notify

# 5. Enable orders only after the earlier stages and account/risk review pass.
yarn signals:daemon -- --user root --connector bybit --notify --makeOrders
```

Monitor signal evaluations, gate-versus-LLM disagreements, order rejects,
slippage, parity mismatches, cadence, and realized ALL/LONG/SHORT economics.
Rollback by disabling the runtime config or removing `--makeOrders`; do not tune
the model from an unversioned live observation. The production runtime may use
a different host and Redis, so verify the actual deployment source of truth
instead of assuming this checkout's local Redis is live.

For environment setup, runtime evidence commands, and operational details, see
[QUICKSTART.md](QUICKSTART.md).

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
yarn checks
yarn build:ci
yarn backtest
yarn research:core
yarn research:core:test
yarn research:core:coverage
yarn results
yarn signals
yarn signals:daemon -- --notify --makeOrders
yarn signals:summary -- --printOnly
yarn bot
```

## Automated npm Releases

Every push to `stable` runs `.github/workflows/publish-images.yml`. The release
workflow:

1. resolves one shared version for every public `@tradejs/*` package
2. resumes the same version after a partial or interrupted release
3. builds, lints, typechecks, tests, and dry-runs every package archive
4. commits synchronized package versions back to `stable`
5. publishes packages in dependency order with npm provenance
6. creates the matching `v<version>` tag only after every publish succeeds

Repository secret `NPM_TOKEN` must contain an npm automation-capable token with
publish access to the `@tradejs` organization. GitHub Actions also receives
`id-token: write` permission for npm provenance. Do not add npm tokens to
`.npmrc`, `.yarnrc.yml`, or repository files.

The first run publishes the current local version when it is newer than npm.
Later runs increment the patch version after the previous npm version and Git
tag are both complete. Manual local publishing remains available through
`yarn publish:packages` and `yarn publish:packages:dry`.

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
- `yarn signals:summary` builds the Telegram digest; current cron sends the daily report every day at `21:00` in `Europe/Moscow` timezone for the last 24 hours and the weekly report on Sundays at `22:10` for the last 168 hours. Immutable runtime evidence is published at `21:05`, and runtime parity runs at `21:10` every day.
- The summary groups signal statuses and trade PnL/status by strategy and uses generated runtime `orderId` linkage (`orderLinkId` on Bybit).

## ML Flow (High-Level)

1. Backtest can write per-worker ML chunks.
2. `yarn ml-export` merges chunks to JSONL export.
3. `yarn ml-train:latest` (or model-specific scripts) prepares holdout/prod/walk-forward splits and trains.
4. `yarn ml-upload:prod` uploads inference aliases.
5. Runtime inference uses gRPC (`ML_GRPC_ADDRESS`) when enabled.

## AI Flow (Offline Prompt Replay)

1. `yarn backtest --ai` writes per-worker AI prompt chunks to `data/ai/export/ai-dataset-<strategy>-chunk-<chunkId>.jsonl`.
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

The release workflow synchronizes the sandbox's direct `@tradejs/*` versions,
publishes the packages, refreshes the standalone lockfile, and runs this e2e flow
before publishing Docker images.

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

## Community

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing or implementing a
  change.
- Use [GitHub Discussions](https://github.com/TradeJS-Dev/TradeJS/discussions)
  for questions, ideas, and project showcases.
- Use [GitHub Issues](https://github.com/TradeJS-Dev/TradeJS/issues) for
  reproducible bugs and actionable work.
- Report vulnerabilities privately by following [SECURITY.md](SECURITY.md).
- See [CHANGELOG.md](CHANGELOG.md) for notable user-facing changes.

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
