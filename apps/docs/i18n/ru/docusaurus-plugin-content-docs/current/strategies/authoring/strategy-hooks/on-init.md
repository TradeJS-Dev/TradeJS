---
title: onInit
---

Вызывается один раз сразу после создания runtime стратегии и до запуска per-candle runner.

## Params

```ts
{
  ctx: StrategyHookCtx;
  market: {
    data: KlineChartItem[];
    btcData: KlineChartItem[];
  };
}
```

## Output

| Возврат          | Тип                        |
| ---------------- | -------------------------- |
| Без return value | `void` или `Promise<void>` |

Этот хук не может блокировать runtime flow. Если он бросает ошибку, runtime логирует ее, вызывает `onRuntimeError` и продолжает работу.
