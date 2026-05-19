# AGENTS.md

## Scope

These repository rules apply to `/Users/aleksnick/dev/investing`.

## Purpose

Use this file as the default operating guide for automated agents in this repo.
Keep changes small, respect package boundaries, and align with the current TradeJS architecture.

## Repository Shape

TradeJS is a monorepo for:

- strategy authoring
- backtesting
- live signal generation
- optional auto-trading
- ML train/infer flows

Main areas:

- `apps/app` — publishable Next.js UI and API package, also used internally in the workspace
- `packages/core` — browser-safe public API, shared helpers, plugin config API
- `packages/node` — Node-only runtime, plugin loading, backtest/pine execution helpers
- `packages/types` — shared contracts and types
- `packages/infra` — Redis / Timescale / ML / IO adapters
- `packages/strategies` — built-in strategy plugins
- `packages/indicators` — built-in indicators
- `packages/connectors` — built-in connectors and market data providers
- `packages/base` — default preset wiring built-ins
- `packages/cli` — operational commands
- `examples/sandbox` — standalone deterministic external-user style example app that installs published `@tradejs/*` packages from npm

Public web repos now live outside this monorepo:

- `TradeJS-Site` — source of truth for `tradejs.dev`
- `TradeJS-Docs` — source of truth for `docs.tradejs.dev`

This monorepo no longer carries the source code for those public web surfaces.

Local checkouts for those repos in this environment:

- `TradeJS`: `~/dev/investing`
- `TradeJS-Site`: `~/dev/tradejs-site`
- `TradeJS-Docs`: `~/dev/tradejs-docs`

Local clone policy for `TradeJS-Dev` repositories:

- keep local clones under `~/dev/...`
- do not clone or stage working copies under `/tmp`

## Audience Rules For Documentation

This rule is important and should be treated as architectural, not editorial.

- `TradeJS-Docs` is for external package users.
- package `README.md` files are also for external package users.
- When a user asks to update public docs articles or site content, search and edit the external repo directly instead of adding surrogate notes in this monorepo.
- If the user says "docs", "knowledge base", "documentation", or similar user-facing wording without explicitly saying "internal", default to the external `TradeJS-Docs` repo at `~/dev/tradejs-docs`, not to internal markdown, notes, skills, or `AGENTS.md` in this monorepo.
- Do not document repo-only flows in `TradeJS-Docs`.
- Do not tell external users to run monorepo-only commands like `yarn dev`, `yarn workspace @tradejs/app dev`, or similar internal workflows in public docs unless the package flow truly supports them.
- Internal repository workflows belong in root markdown files:
  - `README.md`
  - `QUICKSTART.md`
  - `STRATEGY_API.md`
- User-facing setup and account-management articles belong in `TradeJS-Docs`, not in root markdown files here.

If a feature is not publish-ready for external users, document that limitation explicitly instead of implying a working package flow.

## Internal Notes

- Internal research notes and audit-style markdown files should live under `notes/`, not in the repo root.
- Current internal notes include:
  - `notes/AI_TRENDLINE_REPLAY_NOTES.md`
  - `notes/ML_PIPELINE_AUDIT.md`
  - `notes/ML_TRANSFORM_README_RU.md`
- Keep root markdown focused on stable repository guidance and runnable internal workflows.

## Architecture Rules

### Package Boundaries

- `@tradejs/core` is browser-safe public API.
- `@tradejs/node` is Node/server runtime.
- `@tradejs/types` contains shared contracts.
- `@tradejs/infra` contains infra adapters and storage/network integrations.

Do not blur these boundaries without explicit request.

### Public Surface Rules

- `@tradejs/core`, `@tradejs/node`, and `@tradejs/infra` are subpath-first packages.
- `@tradejs/core` has no root export.
- `@tradejs/node` has no root export.
- `@tradejs/infra` has no root export.

Keep public APIs expressed through explicit subpaths such as:

- `@tradejs/core/data`
- `@tradejs/core/strategies`
- `@tradejs/node/pine`
- `@tradejs/node/registry`
- `@tradejs/infra/redis`
- `@tradejs/infra/logger`

### Import Rules

For production code:

- import plugin registration from `@tradejs/core/config`
- import browser-safe helpers from public `@tradejs/core/*` subpaths
- import Node runtime helpers from public `@tradejs/node/*` subpaths
- import infra adapters from public `@tradejs/infra/*` subpaths
- import shared contracts from `@tradejs/types`
- inside `packages/core`, import core-internal helpers through package-local `imports` such as `#utils/*` and `#constants`
- inside `apps/app`, prefer app-local `imports` such as `#app/*`, `#actions/*`, `#store`, `#shared/*`, `#ui`, `#components/*`

Do not:

- use non-public deep imports like `@tradejs/core/src/*` or `@tradejs/node/src/*`
- use non-public deep imports like `@tradejs/infra/src/*`
- reintroduce root imports like `@tradejs/core`, `@tradejs/node`, or `@tradejs/infra`
- add global root-level TypeScript aliases for package-internal modules like `@utils/*` or `@constants`; keep package-internal aliases package-local

### Build Isolation Rules

- Package builds must not depend on `apps/app/.next` or other generated app artifacts.
- `tsup` packages should use package-local `tsconfig.build.json`, not the root build config.
- Tests should live in the package that owns the code under test.
- Do not leave `core` tests pointing at `node` or `infra` internals.

### Strategy Runtime Rules

`core.ts` in a strategy should:

- evaluate entry/exit logic
- return `skip`, `entry`, or `exit`

`core.ts` should not:

- call AI prompt pipeline directly
- call ML gRPC directly
- place/close orders directly

Use `strategyApi` and shared runtime instead.

`strategyApi.entry(...)` expectations:

- strategy provides `direction` and `orderPlan`
- `code` is optional
- runtime resolves `timestamp`, `currentPrice`, `takeProfitPrice`, `riskRatio`

`entryContext` is the source of truth for runtime execution fields.

Runtime AI config conventions:

- `AI_ENABLED` remains the primary runtime AI on/off switch, matching the existing `ML_ENABLED` convention.
- `AI_MODE` selects the AI decision source when `AI_ENABLED=true`.
- Supported `AI_MODE` values are:
  - `llm` — default; runtime calls the configured AI provider and uses the LLM analysis for the AI quality gate.
  - `gate` — runtime uses the local deterministic strategy AI gate for entry quality, while still calling the configured AI provider for Telegram commentary and later gate-vs-LLM comparison.
- In `gate` mode, persist the LLM analysis with gate comparison metadata (`gateAnalysis`, `gateDecision`, `llmDecision`, `gateContradictsLlm`) so later research can compare live gate and LLM behavior.
- Keep `MIN_AI_QUALITY` as the shared quality threshold for both `gate` and `llm` decisions.

### Indicator Rules

- Keep shared indicator logic neutral and reusable.
- Do not add strategy-specific branches inside shared indicator modules unless explicitly requested and architecturally justified.
- If a strategy needs extra series, prefer general-purpose derived fields that other strategies can reuse.
- `additionalIndicators.baseContext` is the canonical current shared indicator snapshot for runtime AI/gate/Telegram/prompt logic.
- `signal.indicators` is the historical indicator/series transport for backtest, replay, and ML transforms. Do not treat it as the primary current-value source for AI/runtime decisions when `baseContext` is available.
- Avoid current-value fallback chains from `additionalIndicators.baseContext` back to legacy flat fields; migrate call sites to the canonical context instead.
- Base shared context should stay grouped by purpose:
  - `raw`: current MA / ATR / BB / OBV / price stats / levels / BTC correlation / venue spread
  - `regime`: trend, volatility, and momentum state
  - `structure`: level distance, range position, breakout/rejection state
  - `participation`: volume, turnover, OBV slope, effort-vs-result
  - `relative`: BTC relative strength and benchmark MA bias
  - `derivatives`: Coinalyze-derived positioning summary
  - `mtf`: compact MTF candle snapshots

### Plugin Rules

Expected public plugin exports:

- strategy plugin: `strategyEntries`
- indicator plugin: `indicatorEntries`
- connector plugin: `connectorEntries`

Project-level registration goes through `tradejs.config.ts` using:

- `strategies`
- `indicators`
- `connectors`

Default preset:

- `basePreset` from `@tradejs/base`

## External User Reality Check

Before documenting or implementing an external-user flow, verify that it truly works outside the monorepo.

Examples:

- `@tradejs/app` and `@tradejs/cli` are publishable packages and should be treated as external entrypoints.
- `examples/sandbox` is intentionally outside the workspace graph and should continue consuming published `@tradejs/*` packages from npm rather than local workspace sources.
- If an npm flow does not work, do not paper over it in public docs.

## Development Commands

Use the existing scripts from root `package.json`.

Common internal commands:

- `yarn dev`
- `yarn infra-up`
- `yarn infra-down`
- `yarn doctor`
- `yarn build:ci`
- `yarn backtest`
- `yarn results`
- `yarn signals`
- `yarn bot`
- `yarn build`
- `yarn lint`
- `yarn typecheck`
- `yarn unit`
- `yarn prettify`

Sandbox:

- `yarn sandbox:install`
- `yarn sandbox:infra-up`
- `yarn sandbox:e2e`
- `yarn sandbox:infra-down`

Publishing:

- `yarn publish:packages:dry`
- `yarn publish:packages`
- `yarn bump:packages patch|minor|major|<version>`

## Testing Expectations

Minimum relevant checks:

- `yarn lint`
- `yarn typecheck`
- `yarn unit`
- `yarn checks` is the preferred umbrella verification when practical

Verification deduplication rule:

- if `yarn checks` was run successfully for the current diff, do not also run its constituent verification commands separately just to repeat the same coverage
- use targeted commands like package-local `typecheck`, specific `jest` paths, or standalone `yarn prettify` only when narrowing down a failure, preflighting a risky change before the full run, or verifying a package in isolation by explicit need

For public docs/site changes:

- make the change in `TradeJS-Docs` or `TradeJS-Site`, not in this monorepo
- run the relevant build in that external repo when practical

For package boundary / import refactors:

- run at least `yarn typecheck`, `yarn build`, and `yarn unit`
- for package-local moves, also run the affected package build/tests directly when practical

For app/runtime changes:

- prefer verifying `yarn build`
- if docs mention a runnable flow, verify the flow is actually supported

For sandbox changes:

- verify `yarn sandbox:install`
- run `yarn sandbox:e2e` when infra is available
- do not re-couple sandbox to workspace-local package sources

## AI Discovery Files

Public web surfaces also include AI discovery assets:

- `TradeJS-Site/public/llms.txt` in `TradeJS-Dev/TradeJS-Site`
- `TradeJS-Site/public/llms-full.txt` in `TradeJS-Dev/TradeJS-Site`
- `TradeJS-Docs/static/llms.txt` in `TradeJS-Dev/TradeJS-Docs`
- `TradeJS-Docs/static/llms-full.txt` in `TradeJS-Dev/TradeJS-Docs`

Keep them aligned with:

- current public package boundaries
- current docs URLs
- current external install flow

## ML Workflow Notes

Keep these conventions stable unless explicitly changing the ML pipeline.

- Use `yarn ml-train:trendline:*` scripts for model training.
- Backtest workers write chunked JSONL files:
  - `ml-dataset-[strategyName]-[chunkId].jsonl`
- `yarn ml-export` merges chunk files to canonical JSONL export.
- Training consumes base JSONL exports, not derived split files.
- Feature-window parity must remain consistent between backtest write path and inference path.
- Keep causality guards intact unless explicitly debugging.
- Treat `runtime-parity` as core/backtest execution parity, not live AI/ML approval parity:
  - it replays in `ENV=BACKTEST` with order placement enabled and compares replayed entry orders to saved runtime trade records
  - `runtime=0` and `backtest=0` for a strategy means the selected replay targets produced no comparable entries in that window; it does not measure how many AI rows would be approved
  - if AI/ML gates matter, inspect runtime signals/evaluations or run `ai-train` separately
- Treat `ai-train` approved cadence metrics as historical dataset averages over selected rows, not a guarantee of one live approved trade on every calendar day.
- `ai-train --localOnly` replays the same local deterministic strategy AI gate used by `AI_MODE=gate`; it does not measure external LLM provider behavior.
- Treat `AI_MODE=gate` metrics as directly comparable to `ai-train --localOnly`, because both use the local deterministic strategy AI gate with the same `MIN_AI_QUALITY` threshold.
- Do not present `ai-train --localOnly` results as `AI_MODE=llm` expectations; `AI_MODE=llm` depends on external model decisions and must be validated from normal `ai-train`, live runtime records, or another replay that actually includes provider output.
- When reporting approved quality metrics, use `qN+` to mean the effective `MIN_AI_QUALITY=N` live stream, which includes every approval with quality `>= N`.
- Do not present plain `q1` / `q2` / `q3` / `q4` / `q5` as the default approved bucket labels unless the user explicitly asks for the isolated subset; default reporting should use `qN+` notation.
- To compare `AI_MODE=gate` and `AI_MODE=llm`, use live/runtime signal analysis records or explicit replay artifacts that contain both gate and LLM decisions.
- TrendLine core/runtime config uses `TRENDLINE`; `TRENDLINE_CONFIG` is used in ML payload/training contexts. When applying backtest or result configs to a live/replay strategy config, make sure detector options land in `TRENDLINE`, or the core may run with stale/default trendline detector settings.

## Generated / Build Files

- Do not rely on generated files as source of truth.
- Do not commit `dist` assumptions into architectural decisions.
- If build tools regenerate files like `next-env.d.ts`, treat that as expected generated output.

## Editing Policy

- Keep diffs focused.
- After any code changes, run `yarn prettify` before further verification or committing.
- Do not rewrite unrelated formatting.
- Do not change public APIs without explicit intent.
- Do not add backward-compat fallbacks unless requested.
- Prefer clear architectural cleanup over transitional indirection when the user explicitly asks for clean breaking refactors.

## When Updating Root Markdown

Use root markdown files for internal repo guidance:

- `README.md` — repository overview and internal workflows
- `QUICKSTART.md` — internal developer startup flow
- `STRATEGY_API.md` — strategy contract and runtime behavior

Keep them aligned with:

- current package boundaries
- actual import policy
- actual runnable commands

## When Unsure

- Prefer the current code and root markdown over stale assumptions.
- If public docs and actual package behavior disagree, trust the package behavior and fix the docs.
- If a flow only works inside the repo, document it only in root markdown, not in `TradeJS-Docs`.
