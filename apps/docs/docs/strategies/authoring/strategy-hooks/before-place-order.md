---
title: beforePlaceOrder
---

Called on the entry path right before connector order placement. This hook fires for both signal and no-signal entries.

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
  policy: StrategyHookPolicyContext;
  ml?: StrategyHookMlContext;
  ai?: StrategyHookAiContext;
};
```

Use `entry.context` instead of a separate top-level `entryContext` alias.

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow. If it throws, the error is logged, `onRuntimeError` is called, and the runtime continues.
