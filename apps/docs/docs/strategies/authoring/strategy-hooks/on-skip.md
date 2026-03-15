---
title: onSkip
---

Called only for `skip` decisions.

## Params

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

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow.
