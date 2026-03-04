---
title: Strategy Runtime Hooks
---

TradeJS strategy manifests support lifecycle hooks to customize runtime behavior without polluting `core.ts`.

Hook contract source:

- `packages/core/src/types/strategyAdapters.ts`

Runtime hook execution:

- `packages/core/src/utils/strategyRuntime.ts`

## Available Hooks

### Initialization and decision flow

- `onInit`

  - called once when strategy runtime is created
  - use for warmup checks and strategy-local setup

- `afterCoreDecision`

  - called after `core.ts` returns `skip|entry|exit`
  - use for diagnostics, normalization, decision telemetry

- `onSkip`
  - called for `skip` decisions
  - use for skip-code analytics and alerting

### Exit path hooks

- `beforeClosePosition`
  - called before runtime executes `connector.closePosition`
  - may return `{ allow: false, reason?: string }` to block close execution

### Entry enrichment and gating

- `afterEnrichMl`

  - called after ML enrichment on signal

- `afterEnrichAi`

  - called after AI enrichment on signal
  - receives `quality`

- `beforeEntryGate`
  - called before order execution after standard runtime policy checks
  - may return `{ allow: false, reason?: string }` to block entry

### Order execution hooks

- `beforePlaceOrder`

  - called immediately before order placement
  - existing hook retained, now with richer context

- `afterPlaceOrder`
  - called after successful order placement
  - receives `orderResult`

### Error hook

- `onRuntimeError`
  - centralized hook for runtime-stage failures (hook errors, enrich errors, order/close errors)
  - receives `stage`, `error`, and optional `decision/signal`

## Manifest Example

```ts
import { StrategyManifest } from '@types';

export const myStrategyManifest: StrategyManifest = {
  name: 'MyStrategy',
  hooks: {
    onInit: async ({ strategyName, symbol }) => {
      console.log('init', strategyName, symbol);
    },
    beforeEntryGate: async ({ signal }) => {
      if (!signal) return;
      // custom policy
      return { allow: true };
    },
    onRuntimeError: async ({ stage, error }) => {
      console.error('runtime hook error', stage, error);
    },
  },
};
```

## Reusable Hook Helpers

To reduce duplication across strategies, shared hook helpers can be used.

Current helper:

- `createCloseOppositeBeforePlaceOrderHook`
  - file: `packages/core/src/utils/strategyHooks.ts`
  - used by `TrendLine` and `VolumeDivergence`

## Notes

- Hook failures do not crash runtime by default; they are routed to `onRuntimeError` and logged.
- `beforeEntryGate` runs only after base runtime policy allows execution.
- `beforeClosePosition` runs only when close execution is enabled (`MAKE_ORDERS=true`).
