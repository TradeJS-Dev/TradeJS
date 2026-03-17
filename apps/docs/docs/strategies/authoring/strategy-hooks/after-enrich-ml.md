---
title: afterEnrichMl
---

Called on the entry path after the ML stage. This hook only fires when `decision.signal` exists.

## Params

```ts
type Params = {
  ctx: StrategyHookCtx;
  market: {
    candle: KlineChartItem;
    btcCandle: KlineChartItem;
  };
  decision: EntryDecision;
  entry: StrategyHookEntryContext;
  ml: StrategyHookMlContext;
};
```

`ml` is explicit stage metadata:

- `ml.attempted === false` means runtime skipped ML before any ML request.
- `ml.applied === true` means ML produced a result and `ml.result` mirrors `entry.signal?.ml`.
- `ml.skippedReason` explains why the stage was a no-op.

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow. If it throws, the error is logged, `onRuntimeError` is called, and the runtime continues.
