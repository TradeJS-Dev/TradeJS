---
title: Strategy Runtime Hooks
---

TradeJS strategy manifests support lifecycle hooks to customize runtime behavior without overloading `core.ts`.

## Source of Truth

- Hook contracts and context types: `packages/core/src/types/strategyAdapters.ts`
- Runtime execution order and stage names: `packages/core/src/utils/strategyRuntime.ts`
- Shared hook helpers: `packages/core/src/utils/strategyHooks.ts`

## Full Hook Typing (`StrategyManifest['hooks']`)

```ts
type StrategyManifestHooks = {
  onInit?: (params: StrategyHookInitContext) => Promise<void> | void;
  afterCoreDecision?: (
    params: StrategyHookAfterDecisionContext,
  ) => Promise<void> | void;
  onSkip?: (params: StrategyHookSkipContext) => Promise<void> | void;
  beforeClosePosition?: (
    params: StrategyHookBeforeCloseContext,
  ) => Promise<StrategyHookGateResult | void> | StrategyHookGateResult | void;
  afterEnrichMl?: (params: StrategyHookEnrichContext) => Promise<void> | void;
  afterEnrichAi?: (params: StrategyHookAfterAiContext) => Promise<void> | void;
  beforeEntryGate?: (
    params: StrategyHookBeforeEntryGateContext,
  ) => Promise<StrategyHookGateResult | void> | StrategyHookGateResult | void;
  beforePlaceOrder?: (
    params: StrategyHookBeforePlaceOrderContext,
  ) => Promise<void> | void;
  afterPlaceOrder?: (
    params: StrategyHookAfterPlaceOrderContext,
  ) => Promise<void> | void;
  onRuntimeError?: (params: StrategyHookErrorContext) => Promise<void> | void;
};
```

## Hook Catalog

| Hook                  | Params type                           | Return type                                                                 | Runtime stage         | Can block flow           |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------------- | --------------------- | ------------------------ |
| `onInit`              | `StrategyHookInitContext`             | `void \| Promise<void>`                                                     | `onInit`              | No                       |
| `afterCoreDecision`   | `StrategyHookAfterDecisionContext`    | `void \| Promise<void>`                                                     | `afterCoreDecision`   | No                       |
| `onSkip`              | `StrategyHookSkipContext`             | `void \| Promise<void>`                                                     | `onSkip`              | No                       |
| `beforeClosePosition` | `StrategyHookBeforeCloseContext`      | `StrategyHookGateResult \| void \| Promise<StrategyHookGateResult \| void>` | `beforeClosePosition` | Yes (`{ allow: false }`) |
| `afterEnrichMl`       | `StrategyHookEnrichContext`           | `void \| Promise<void>`                                                     | `afterEnrichMl`       | No                       |
| `afterEnrichAi`       | `StrategyHookAfterAiContext`          | `void \| Promise<void>`                                                     | `afterEnrichAi`       | No                       |
| `beforeEntryGate`     | `StrategyHookBeforeEntryGateContext`  | `StrategyHookGateResult \| void \| Promise<StrategyHookGateResult \| void>` | `beforeEntryGate`     | Yes (`{ allow: false }`) |
| `beforePlaceOrder`    | `StrategyHookBeforePlaceOrderContext` | `void \| Promise<void>`                                                     | `beforePlaceOrder`    | No                       |
| `afterPlaceOrder`     | `StrategyHookAfterPlaceOrderContext`  | `void \| Promise<void>`                                                     | `afterPlaceOrder`     | No                       |
| `onRuntimeError`      | `StrategyHookErrorContext`            | `void \| Promise<void>`                                                     | `onRuntimeError`      | No                       |

## Context Types

### Base context

| Type                      | Fields                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `StrategyHookBaseContext` | `connector`, `strategyName`, `userName`, `symbol`, `config`, `env`, `isConfigFromBacktest` |

### Context extensions used by hooks

| Type                                  | Extends                            | Extra fields                                                                                |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `StrategyHookInitContext`             | `StrategyHookBaseContext`          | `data`, `btcData`                                                                           |
| `StrategyHookAfterDecisionContext`    | `StrategyHookBaseContext`          | `decision`, `candle`, `btcCandle`                                                           |
| `StrategyHookSkipContext`             | `StrategyHookAfterDecisionContext` | `decision` narrowed to `Extract<StrategyDecision, { kind: 'skip' }>`                        |
| `StrategyHookBeforeCloseContext`      | `StrategyHookBaseContext`          | `decision` narrowed to `Extract<StrategyDecision, { kind: 'exit' }>`                        |
| `StrategyHookEnrichContext`           | `StrategyHookBaseContext`          | `decision` narrowed to `Extract<StrategyDecision, { kind: 'entry' }>`, `runtime`, `signal?` |
| `StrategyHookAfterAiContext`          | `StrategyHookEnrichContext`        | `quality?`                                                                                  |
| `StrategyHookBeforeEntryGateContext`  | `StrategyHookAfterAiContext`       | `makeOrdersEnabled`, `minAiQuality`                                                         |
| `StrategyHookBeforePlaceOrderContext` | `StrategyHookBaseContext`          | `entryContext`, `runtime`, `decision` narrowed to entry, `signal?`                          |
| `StrategyHookAfterPlaceOrderContext`  | `StrategyHookEnrichContext`        | `orderResult`                                                                               |
| `StrategyHookErrorContext`            | `StrategyHookBaseContext`          | `stage`, `error`, `decision?`, `signal?`                                                    |
| `StrategyHookGateResult`              | -                                  | `{ allow?: boolean; reason?: string }`                                                      |

## Runtime Order (Entry/Exit Paths)

| Order | Hook                  | Notes                                             |
| ----- | --------------------- | ------------------------------------------------- |
| 1     | `onInit`              | Called once when runtime is created               |
| 2     | `afterCoreDecision`   | Called for every decision from `core.ts`          |
| 3     | `onSkip`              | Called only for `skip` decisions                  |
| 4     | `beforeClosePosition` | Exit path only, before `connector.closePosition`  |
| 5     | `afterEnrichMl`       | Entry path only, after ML enrichment              |
| 6     | `afterEnrichAi`       | Entry path only, after AI enrichment              |
| 7     | `beforeEntryGate`     | Entry path only, after standard policy checks     |
| 8     | `beforePlaceOrder`    | Entry path only, right before order placement     |
| 9     | `afterPlaceOrder`     | Entry path only, after successful order placement |
| \*    | `onRuntimeError`      | Called when runtime-stage errors are caught       |

## Manifest Example

```ts
import { StrategyManifest } from '@tradejs/core';

export const myStrategyManifest: StrategyManifest = {
  name: 'MyStrategy',
  hooks: {
    onInit: async ({ strategyName, symbol }) => {
      console.log('init', strategyName, symbol);
    },
    beforeEntryGate: async ({ signal }) => {
      if (!signal) return;
      return { allow: true };
    },
    onRuntimeError: async ({ stage, error }) => {
      console.error('runtime hook error', stage, error);
    },
  },
};
```

## Reusable Hook Helper

Built-in helper currently used by `TrendLine` and `VolumeDivergence`:

- `createCloseOppositeBeforePlaceOrderHook`
- source: `packages/core/src/utils/strategyHooks.ts`

## Notes

- Hook failures do not crash runtime by default: runtime catches them, logs them, and routes them to `onRuntimeError`.
- Gate hooks are only `beforeClosePosition` and `beforeEntryGate`; they can block flow via `{ allow: false }`.
- `beforeClosePosition` only affects actual close execution (`MAKE_ORDERS=true`).
