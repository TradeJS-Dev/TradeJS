---
title: onSkip
---

Called only when `core.ts` returns a `skip` decision.

## Params

```ts
type Params = {
  ctx: StrategyHookCtx;
  market: {
    candle: KlineChartItem;
    btcCandle: KlineChartItem;
  };
  decision: SkipDecision;
};
```

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow. If it throws, the error is logged, `onRuntimeError` is called, and the runtime continues.
