# Strategy API Guide

Updated for current architecture (`shared runtime + strategy manifests/adapters`).

## Purpose

This document describes the contracts for implementing strategies:

- strategy `core.ts` responsibilities
- shared runtime responsibilities
- AI/ML/hook extension points
- `StrategyDecision` shape

## Strategy File Layout

Recommended structure for `packages/core/src/strategy/<Strategy>`:

- `config.ts`
- `core.ts`
- `figures.ts` (recommended)
- `strategy.ts`
- `manifest.ts`
- `adapters/ai.ts` (optional)
- `adapters/ml.ts` (optional)
- `hooks.ts` (optional)
- `<strategy>.pine` (optional, for Pine-backed strategies)

## Layer Responsibilities

### `core.ts`

`core.ts` should:

- evaluate entry/exit logic from config + market context
- return `StrategyDecision` (`skip`, `entry`, or `exit`)

`core.ts` should not:

- call AI prompt pipeline directly
- call ML gRPC directly
- place/close orders directly

Use `strategyApi` for shared operations.

### `strategy.ts`

Thin wiring layer:

- `createStrategyRuntime(...)`
- strategy defaults
- `createCore`

### `manifest.ts`

Strategy-local runtime extension point:

- `name`
- `entryRuntimeDefaults` (optional)
- `hooks.beforePlaceOrder` (optional)
- `aiAdapter` (optional)
- `mlAdapter` (optional)

### Shared Runtime

`packages/core/src/utils/strategyRuntime.ts` does:

- config resolution
- `core` execution
- AI/ML enrichment and gating
- order execution
- hook invocation

## `StrategyDecision` Contract

### `skip`

```ts
return strategyApi.skip('NO_SIGNAL');
```

### `entry`

Use `strategyApi.entry(...)` and provide:

- `direction`
- `timestamp`
- `prices`
- `orderPlan`
- optional `figures`, `indicators`, `additionalIndicators`, `runtime`, `code`

`entryContext` is the source of truth for runtime execution fields.
`orderPlan` should contain execution-only details (qty, take profits).

### `exit`

```ts
return {
  kind: 'exit',
  code: 'CLOSE_POSITION_BY_RULE',
  closePlan: { price, timestamp, direction },
};
```

## `strategyApi` (Preferred DSL)

Shared runtime passes `strategyApi` into strategy core.

Main methods:

- `skip(code)`
- `entry(params)`
- `getMarketData(params?)`
- `getCurrentPosition()`
- `isCurrentPositionExists()`
- `getDirectionalTpSlPrices(params)`
- `createLastTradeController(params?)`

Detailed method reference:

- `STRATEGY_API_REFERENCE.md`

## Runtime Policy: AI/ML

Preferred policy sources:

1. strategy manifest defaults (`entryRuntimeDefaults`)
2. adapter mapping (`mapEntryRuntimeFromConfig`)
3. rare per-decision override (`decision.runtime`)

Runtime merge order:

1. manifest defaults
2. adapter-derived runtime from strategy config
3. decision runtime overrides

## Strategy Adapters

### AI Adapter

`aiAdapter` may provide:

- `buildPayload`
- `buildSystemPromptAddon`
- `buildHumanPromptAddon`
- `mapEntryRuntimeFromConfig`

### ML Adapter

`mlAdapter` may provide:

- `normalizeSignal`
- `normalizeStrategyConfig`
- `mapEntryRuntimeFromConfig`

## Hooks

Current strategy-level hook in manifest:

- `beforePlaceOrder({ connector, entryContext, config, runtime })`

Typical use case:

- close opposite positions before opening a new one

## Pine Strategy Support

For Pine-backed strategies:

- keep Pine source in a dedicated `.pine` file inside strategy folder
- runtime injects `loadPineScript(...)` into `CreateStrategyCore` params
- strategy `core.ts` executes Pine and maps plots into signal fields/figures

## Recommended Implementation Rules

1. Keep `core.ts` focused on strategy logic only.
2. Keep cross-strategy figure format standardized (`lines/points/zones`).
3. Put strategy-specific diagnostics into `additionalIndicators`.
4. Prefer adapter/manifest policy over core-level AI/ML toggling logic.
5. Reuse `strategyApi` helpers instead of duplicating runtime-aware logic.

## Related Files

- `packages/core/src/types/strategy.ts`
- `packages/core/src/types/strategyAdapters.ts`
- `packages/core/src/utils/strategyRuntime.ts`
- `packages/core/src/utils/strategyHelpers/signalBuilders.ts`
