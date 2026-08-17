# Strategy API

Updated for current architecture (`shared runtime + strategy manifests/adapters`).

## Purpose

This document is the single source of truth for strategy implementation contracts:

- strategy `core.ts` responsibilities
- shared runtime responsibilities
- `StrategyDecision` shape
- AI/ML adapters and manifest policy
- `strategyApi` method reference

## Import Policy

Strategy/plugin code should import runtime helpers from explicit public `@tradejs/core/*` and `@tradejs/node/*` subpaths and shared types from `@tradejs/types`.

- use: `import { createStrategyRuntime } from '@tradejs/node/strategies'`
- use: `import { CreateStrategyCore } from '@tradejs/types'`
- do not use internal aliases (`@utils`, `@constants`)
- do not use non-public deep imports
- do not rely on test-only helpers under `packages/core/src/utils/testHelpers/*`

## Strategy File Layout

Recommended structure for `src/<Strategy>` in a standalone strategy repository
or `src/strategies/<Strategy>` in a user project:

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

- exports a `StrategyRegistryEntry`
- binds the strategy `manifest`, `defaults`, and `createCore`
- does not import or construct the Node runtime

### `manifest.ts`

Strategy-local runtime extension point:

- `name`
- `entryRuntimeDefaults` (optional)
- `hooks.*` lifecycle hooks (optional)
- `aiAdapter` (optional)
- `mlAdapter` (optional)

### Shared Runtime

`packages/node/src/strategyRuntime.ts` handles:

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
- `orderPlan`
- optional `code`, `figures`, `indicators`, `additionalIndicators`, `runtime`, `signalId`

Rules:

- `entryContext` is the source of truth for runtime execution fields.
- `orderPlan` contains execution-only details:
  - `qty`
  - `stopLossPrice`
  - `takeProfits`
- if `code` is omitted, it is auto-generated as `<STRATEGY_NAME>_<DIRECTION>_ENTRY`.
- `timestamp/currentPrice/takeProfitPrice/riskRatio` are auto-resolved by shared `strategyApi.entry(...)`.

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
- load and execute Pine through the explicit server-only `@tradejs/node/pine`
  adapter
- keep file-system access outside the pure `CreateStrategyCore` contract
- map Pine results into normal strategy inputs before evaluating the core

Pine support is limited to strategy modules. Custom indicator plugins use TypeScript; standalone Pine indicator plugins are not supported.

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

Returns: `Promise<entry decision>`.

Common fields:

- `direction`
- `orderPlan`:
  - `qty`
  - `stopLossPrice`
  - `takeProfits`
- optional: `code`, `figures`, `indicators`, `additionalIndicators`, `runtime`, `signalId`

Behavior:

- resolves the current closed candle from decision context to fill:
  - `timestamp`
  - `currentPrice`
- derives `takeProfitPrice` from `orderPlan.takeProfits`:
  - `LONG` -> max TP price
  - `SHORT` -> min TP price
- computes `riskRatio` automatically from direction/current/tp/sl
- uses provided `code`; if omitted generates `<STRATEGY_NAME>_<DIRECTION>_ENTRY`

### `strategyApi.exit(params)`

Builds an `exit` decision from:

- `direction`
- optional `code`

The shared runtime always resolves exit `price` and `timestamp` from the
current closed candle. Strategy cores must not provide manual execution fields
or return raw `{ kind: 'exit' }` objects.

### `strategyApi.getDecisionPriceContext()`

Returns the current closed candle decision context:

- `candle`
- `timestamp`
- `currentPrice` (equal to `candle.close`)

This method does not advance indicators or load market history.

### `strategyApi.getCurrentIndicatorsContext()`

Returns the current strategy indicator snapshot and optional `baseContext`.
The snapshot type comes from the strategy's `CreateStrategyCore` declaration;
callers must not provide a generic type argument.

### `strategyApi.getBaseContext()`

Returns the current shared `BaseStrategyContextSnapshot` when available.

### `strategyApi.getCurrentPosition()`

Wrapper for:

- `connector.getPosition(symbol)`

### `strategyApi.getDirectionalTpSlPrices(params)`

Shared TP/SL/risk helper. Returns:

- `stopLossPrice`
- `takeProfitPrice`
- `riskRatio`
- `qty` (when `maxLossValue` is provided)

### `strategyApi.createLastTradeController(params?)`

Creates a bounded trade-cooldown controller. Pass `enabled` explicitly when
the cooldown is part of strategy behavior; omitting it retains the legacy
BACKTEST-only default. The cooldown boundary is inclusive.

BACKTEST config cells and PARITY runtimes keep isolated controller state.
The signals daemon reuses it across reconstructed CRON wrappers through the
lifecycle-scoped strategy state key. A one-shot CRON process or daemon restart
without a restored lifecycle checkpoint starts with an empty cooldown.

### Runtime Notes

- StrategyAPI does not expose full market history to strategy cores.
- Entry and exit decision fields always come from the current closed candle.
- `indicatorsState` is already wired with current bar by runtime.
- `indicatorsState.snapshot()` is lazy-init safe via shared wrappers.

### Typical `core.ts` Pattern

```ts
return async () => {
  const position = await strategyApi.getCurrentPosition();
  if (position && position.qty > 0) {
    return strategyApi.skip('POSITION_EXISTS');
  }

  const { indicators, baseContext } = strategyApi.getCurrentIndicatorsContext();
  if (!indicators || !baseContext) {
    return strategyApi.skip('WAIT_DATA');
  }

  const { currentPrice } = await strategyApi.getDecisionPriceContext();

  const { stopLossPrice, takeProfitPrice } =
    strategyApi.getDirectionalTpSlPrices({
      price: currentPrice,
      direction: 'LONG',
      takeProfitDelta: 2,
      stopLossDelta: 1,
      unit: 'percent',
    });

  return strategyApi.entry({
    direction: 'LONG',
    orderPlan: {
      qty: 1,
      stopLossPrice,
      takeProfits: [{ rate: 1, price: takeProfitPrice }],
    },
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

- `packages/types/src/strategy.ts`
- `packages/types/src/strategyAdapters.ts`
- `packages/node/src/strategyRuntime.ts`
- `packages/node/src/strategy/manifests.ts`
- `packages/core/src/utils/strategyHelpers/signalBuilders.ts`
