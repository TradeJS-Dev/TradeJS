---
title: afterCoreDecision
---

Called right after `core.ts` returns any decision.

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
  decision: SkipDecision | EntryDecision | ExitDecision;
  candle: KlineChartItem;
  btcCandle: KlineChartItem;
}
```

`SkipDecision` shape:

```ts
{
  kind: 'skip';
  code: string;
}
```

`ExitDecision` shape:

```ts
{
  kind: 'exit';
  code: string;
  closePlan: {
    price: number;
    timestamp: number;
    direction: 'LONG' | 'SHORT';
  }
}
```

`EntryDecision` shape:

```ts
{
  kind: 'entry';
  code: string;
  entryContext: {
    strategy: string;
    symbol: string;
    interval: string;
    direction: 'LONG' | 'SHORT';
    timestamp: number;
    prices: {
      currentPrice: number;
      takeProfitPrice: number;
      stopLossPrice: number;
      riskRatio: number;
    };
    isConfigFromBacktest?: boolean;
  };
  orderPlan: {
    qty: number;
    stopLossPrice: number;
    takeProfits: Array<{ price: number; rate: number; done?: boolean }>;
  };
  runtime?: {
    ml?: { enabled?: boolean; strategyConfig?: StrategyConfig; mlThreshold?: number };
    ai?: { enabled?: boolean; minQuality?: number };
    beforePlaceOrder?: () => Promise<void>;
  };
  signal?: Signal;
}
```

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow. If it throws, the error is logged, `onRuntimeError` is called, and the runtime continues.
