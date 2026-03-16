---
title: afterCoreDecision
---

Вызывается сразу после того, как `core.ts` вернул любое решение.

## Params

```ts
{
  ctx: StrategyHookCtx;
  market: {
    candle: KlineChartItem;
    btcCandle: KlineChartItem;
  };
  decision: SkipDecision | EntryDecision | ExitDecision;
}
```

## Output

| Возврат         | Тип                       |
| --------------- | ------------------------- |
| Без return value | `void` или `Promise<void>` |

Этот хук не может блокировать runtime flow. Если он бросает ошибку, runtime логирует ее, вызывает `onRuntimeError` и продолжает работу.
