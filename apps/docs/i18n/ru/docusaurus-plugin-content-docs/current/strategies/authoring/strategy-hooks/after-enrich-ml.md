---
title: afterEnrichMl
---

Вызывается на entry path после ML stage. Этот хук вызывается только когда существует `decision.signal`.

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
}
```

`ml` содержит явный статус stage:

- `ml.attempted === false` значит, что runtime пропустил ML до любого ML request.
- `ml.applied === true` значит, что ML дал результат, и `ml.result` зеркалит `entry.signal?.ml`.
- `ml.skippedReason` объясняет, почему stage оказался no-op.

## Output

| Возврат          | Тип                        |
| ---------------- | -------------------------- |
| Без return value | `void` или `Promise<void>` |

Этот хук не может блокировать runtime flow. Если он бросает ошибку, runtime логирует ее, вызывает `onRuntimeError` и продолжает работу.
