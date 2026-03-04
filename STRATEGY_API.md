# Strategy API

Updated for current architecture (`shared runtime + strategy manifests/adapters`).

## Purpose

This document is the single source of truth for strategy implementation contracts:

- strategy `core.ts` responsibilities
- shared runtime responsibilities
- `StrategyDecision` shape
- AI/ML adapters and manifest policy
- `strategyApi` method reference

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
- `<strategy>.pine` (optional for Pine-backed strategies)

## Layer Responsibilities

### `core.ts`

`core.ts` should:

- evaluate entry/exit logic from config + market context
- return a `StrategyDecision` (`skip`, `entry`, or `exit`)

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
- `hooks.*` lifecycle hooks (optional)
- `aiAdapter` (optional)
- `mlAdapter` (optional)

### Shared Runtime

`packages/core/src/utils/strategyRuntime.ts` handles:

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
- optional `figures`, `indicators`, `additionalIndicators`, `runtime`, `code`, `signalId`

Rules:

- `entryContext` is the source of truth for runtime execution fields.
- `orderPlan` should contain execution-only details (qty, take profits).

### `exit`

```ts
return {
  kind: 'exit',
  code: 'CLOSE_POSITION_BY_RULE',
  closePlan: { price, timestamp, direction },
};
```

## Runtime Policy: AI/ML

Preferred policy sources:

1. strategy manifest defaults (`entryRuntimeDefaults`)
2. adapter mapping (`mapEntryRuntimeFromConfig`)
3. rare per-decision override (`decision.runtime`)

Runtime merge order:

1. manifest defaults
2. adapter-derived runtime policy from strategy config
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

Manifest lifecycle hooks:

- `onInit`
- `afterCoreDecision`
- `onSkip`
- `beforeClosePosition` (can return `{ allow: false, reason? }`)
- `afterEnrichMl`
- `afterEnrichAi`
- `beforeEntryGate` (can return `{ allow: false, reason? }`)
- `beforePlaceOrder`
- `afterPlaceOrder`
- `onRuntimeError`

Typical use cases:

- close opposite positions before opening a new one
- custom entry/exit gating by session or risk context
- strategy-level telemetry and diagnostics

## Pine Strategy Support

For Pine-backed strategies:

- keep Pine source in a dedicated `.pine` file inside strategy folder
- runtime injects `loadPineScript(...)` into `CreateStrategyCore` params
- strategy `core.ts` executes Pine and maps plots into signal fields/figures

## `strategyApi` Reference

### What `strategyApi` Is

`strategyApi` is the DSL object passed by shared runtime into `createCore(...)`.

Goals:

- reduce boilerplate in strategy cores
- provide consistent access to runtime context and helper logic

### `strategyApi.skip(code)`

Returns a `skip` decision.

```ts
return strategyApi.skip('NO_SIGNAL');
```

### `strategyApi.entry(params)`

Builds an `entry` decision + signal through shared builders.

Common fields:

- `direction`
- `timestamp`
- `prices`
- `orderPlan`
- optional: `code`, `figures`, `indicators`, `additionalIndicators`, `runtime`, `signalId`

Behavior:

- if `code` is omitted, runtime uses `<STRATEGY_NAME>_SIGNAL`

### `strategyApi.getMarketData(params?)`

Returns market snapshot:

- `fullData`
- `lastCandle`
- `timestamp` (equal to `lastCandle.timestamp`)
- `currentPrice`

Uses runtime defaults unless overridden:

- `preloadStart`
- `backtestPriceMode`

### `strategyApi.getCurrentPosition()`

Wrapper for:

- `connector.getPosition(symbol)`

### `strategyApi.isCurrentPositionExists()`

Returns `true` when an open position exists (`qty > 0`).

### `strategyApi.getDirectionalTpSlPrices(params)`

Shared TP/SL/risk helper. Returns:

- `stopLossPrice`
- `takeProfitPrice`
- `riskRatio`
- `qty` (when `maxLossValue` is provided)

### `strategyApi.createLastTradeController(params?)`

Creates reusable trade cooldown state controller.

### Runtime Notes

- `getMarketData()` reads from runtime-managed candle history.
- `indicatorsState` is already wired with current bar by runtime.
- `indicatorsState.snapshot()` is lazy-init safe via shared wrappers.

### Typical `core.ts` Pattern

```ts
return async () => {
  const { currentPrice, timestamp } = await strategyApi.getMarketData();

  if (await strategyApi.isCurrentPositionExists()) {
    return strategyApi.skip('POSITION_EXISTS');
  }

  const { stopLossPrice, takeProfitPrice, riskRatio, qty } =
    strategyApi.getDirectionalTpSlPrices({
      price: currentPrice,
      direction: 'LONG',
      takeProfitDelta: 2,
      stopLossDelta: 1,
      unit: 'percent',
    });

  if (!qty || qty <= 0) {
    return strategyApi.skip('INVALID_QTY');
  }

  return strategyApi.entry({
    direction: 'LONG',
    timestamp,
    prices: { currentPrice, takeProfitPrice, stopLossPrice, riskRatio },
    orderPlan: { qty, takeProfits: [{ rate: 1, price: takeProfitPrice }] },
  });
};
```

## Recommended Implementation Rules

1. Keep `core.ts` focused on strategy logic only.
2. Keep figure format standardized (`lines/points/zones`) for cross-strategy UI.
3. Store strategy-specific diagnostics in `additionalIndicators`.
4. Prefer adapter/manifest policy over core-level AI/ML branching.
5. Reuse `strategyApi` helpers instead of duplicating runtime-aware logic.

## Related Files

- `packages/core/src/types/strategy.ts`
- `packages/core/src/types/strategyAdapters.ts`
- `packages/core/src/utils/strategyRuntime.ts`
- `packages/core/src/utils/strategyHelpers/signalBuilders.ts`
