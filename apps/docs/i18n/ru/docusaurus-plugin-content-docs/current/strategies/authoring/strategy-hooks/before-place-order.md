---
title: beforePlaceOrder
---

Вызывается на entry path прямо перед постановкой ордера через коннектор. Этот хук вызывается и для signal, и для no-signal entry.

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
}
```

Используй `entry.context` вместо отдельного top-level alias `entryContext`.

## Output

| Возврат         | Тип                       |
| --------------- | ------------------------- |
| Без return value | `void` или `Promise<void>` |

Этот хук не может блокировать runtime flow. Если он бросает ошибку, runtime логирует ее, вызывает `onRuntimeError` и продолжает работу.
