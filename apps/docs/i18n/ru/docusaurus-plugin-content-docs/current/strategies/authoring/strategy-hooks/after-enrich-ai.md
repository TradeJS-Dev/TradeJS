---
title: afterEnrichAi
---

Вызывается на entry path после AI stage. Этот хук вызывается только когда существует `decision.signal`.

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

`ai.quality` присутствует только когда `ai.applied === true`. Если AI был пропущен или не вернул quality, смотри `ai.attempted` и `ai.skippedReason`.

## Output

| Возврат          | Тип                        |
| ---------------- | -------------------------- |
| Без return value | `void` или `Promise<void>` |

Этот хук не может блокировать runtime flow. Если он бросает ошибку, runtime логирует ее, вызывает `onRuntimeError` и продолжает работу.
