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

- `apps/app` — internal Next.js UI and API
- `apps/docs` — public Docusaurus documentation for external package users
- `apps/site` — public marketing site
- `packages/core` — browser-safe public API, shared helpers, plugin config API
- `packages/node` — Node-only runtime, plugin loading, backtest/pine execution helpers
- `packages/types` — shared contracts and types
- `packages/infra` — Redis / Timescale / ML / IO adapters
- `packages/strategies` — built-in strategy plugins
- `packages/indicators` — built-in indicators
- `packages/connectors` — built-in connectors and market data providers
- `packages/base` — default preset wiring built-ins
- `packages/cli` — operational commands
- `examples/sandbox` — deterministic external-user style example app

## Audience Rules For Documentation

This rule is important and should be treated as architectural, not editorial.

- `apps/docs` is for external package users.
- Do not document repo-only flows in `apps/docs`.
- Do not tell external users to run monorepo-only commands like `yarn dev`, `yarn workspace @tradejs/app dev`, or similar internal workflows in public docs unless the package flow truly supports them.
- Internal repository workflows belong in root markdown files:
  - `README.md`
  - `QUICKSTART.md`
  - `STRATEGY_API.md`

If a feature is not publish-ready for external users, document that limitation explicitly instead of implying a working package flow.

## Architecture Rules

### Package Boundaries

- `@tradejs/core` is browser-safe public API.
- `@tradejs/node` is Node/server runtime.
- `@tradejs/types` contains shared contracts.
- `@tradejs/infra` contains infra adapters and storage/network integrations.

Do not blur these boundaries without explicit request.

### Import Rules

For production code:

- import plugin registration from `@tradejs/core/config`
- import browser-safe helpers from public `@tradejs/core/*` subpaths
- import Node runtime helpers from public `@tradejs/node/*` subpaths
- import shared contracts from `@tradejs/types`

Do not:

- use non-public deep imports like `@tradejs/core/src/*` or `@tradejs/node/src/*`
- reintroduce root `@tradejs/core` catch-all imports

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

### Indicator Rules

- Keep shared indicator logic neutral and reusable.
- Do not add strategy-specific branches inside shared indicator modules unless explicitly requested and architecturally justified.
- If a strategy needs extra series, prefer general-purpose derived fields that other strategies can reuse.

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

- `@tradejs/app` is currently internal-only and not publish-ready if it remains `private`, depends on repo-local workspace protocols, or assumes repo-local files.
- If an npm flow does not work, do not paper over it in public docs.

## Development Commands

Use the existing scripts from root `package.json`.

Common internal commands:

- `yarn dev`
- `yarn infra-up`
- `yarn infra-down`
- `yarn doctor`
- `yarn backtest`
- `yarn results`
- `yarn signals`
- `yarn bot`
- `yarn build`
- `yarn lint`
- `yarn typecheck`
- `yarn unit`
- `yarn prettify`

Docs:

- `yarn docs:dev`
- `yarn docs:build`

Sandbox:

- `cd examples/sandbox && yarn install && yarn e2e`

## Testing Expectations

Minimum relevant checks:

- `yarn lint`
- `yarn typecheck`
- `yarn unit`

For docs-only changes:

- run `yarn workspace @tradejs/docs build` when practical

For package boundary / import refactors:

- run at least `yarn typecheck`, `yarn build`, and `yarn unit`

For app/runtime changes:

- prefer verifying `yarn build`
- if docs mention a runnable flow, verify the flow is actually supported

## ML Workflow Notes

Keep these conventions stable unless explicitly changing the ML pipeline.

- Use `yarn ml-train:trendline:*` scripts for model training.
- Backtest workers write chunked JSONL files:
  - `ml-dataset-[strategyName]-[chunkId].jsonl`
- `yarn ml-export` merges chunk files to canonical JSONL export.
- Training consumes base JSONL exports, not derived split files.
- Feature-window parity must remain consistent between backtest write path and inference path.
- Keep causality guards intact unless explicitly debugging.

## Generated / Build Files

- Do not rely on generated files as source of truth.
- Do not commit `dist` assumptions into architectural decisions.
- If build tools regenerate files like `next-env.d.ts`, treat that as expected generated output.

## Editing Policy

- Keep diffs focused.
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
- If a flow only works inside the repo, document it only in root markdown, not in `apps/docs`.
