---
title: afterEnrichAi
---

Called on the entry path after the AI stage. This hook only fires when `decision.signal` exists.

## Params

```ts
{
  ctx: StrategyHookCtx;
  market: {
    candle: KlineChartItem;
    btcCandle: KlineChartItem;
  }
  decision: EntryDecision;
  entry: StrategyHookEntryContext;
  ml: StrategyHookMlContext;
  ai: StrategyHookAiContext;
}
```

`ai.quality` is present only when `ai.applied === true`. When AI was skipped or produced no score, inspect `ai.attempted` and `ai.skippedReason`.

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow. If it throws, the error is logged, `onRuntimeError` is called, and the runtime continues.
