---
title: onInit
---

Called once, right after strategy runtime creation and before the per-candle runner starts.

## Params

```tstype
{
  ctx: StrategyHookCtx;
  market: {
    data: KlineChartItem[];
    btcData: KlineChartItem[];
  };
}
```

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow. If it throws, the error is logged, `onRuntimeError` is called, and the runtime continues.
