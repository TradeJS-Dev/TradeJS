---
title: onSkip
---

Вызывается только для решений `skip`.

## Параметры

```ts
{
  connector: Connector;
  strategyName: string;
  userName: string;
  symbol: string;
  config: StrategyConfig;
  env: string;
  isConfigFromBacktest: boolean;
  decision: {
    kind: 'skip';
    code: string;
  }
  candle: KlineChartItem;
  btcCandle: KlineChartItem;
}
```

## Выход

| Возврат      | Тип                        |
| ------------ | -------------------------- |
| Без значения | `void` или `Promise<void>` |

Этот хук не блокирует выполнение runtime.
