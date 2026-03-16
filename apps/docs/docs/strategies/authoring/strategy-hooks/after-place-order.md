---
title: afterPlaceOrder
---

Called on the entry path right after a successful order placement call. This hook fires for both signal and no-signal entries.

## Params

```ts
{
  ctx: StrategyHookCtx;
  market: {
    candle: KlineChartItem;
    btcCandle: KlineChartItem;
  };
  decision: EntryDecision;
  entry: StrategyHookEntryContext;
  policy: StrategyHookPolicyContext;
  ml?: StrategyHookMlContext;
  ai?: StrategyHookAiContext;
  order: StrategyHookOrderContext;
}
```

`order.result` depends on the entry path:

- With signal: `order.result` is the `Signal` object.
- Without signal: `order.result` is the `decision.code` string.

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow. If it throws, the error is logged, `onRuntimeError` is called, and the runtime continues.
