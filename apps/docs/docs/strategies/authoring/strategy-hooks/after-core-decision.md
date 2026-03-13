---
title: afterCoreDecision
---

Called right after `core.ts` returns any decision.

## Input (`params`)

| Field                  | Type                      | Description                                    |
| ---------------------- | ------------------------- | ---------------------------------------------- | ------------- | ------------------------------- |
| `connector`            | `object`                  | Exchange connector instance.                   |
| `strategyName`         | `string`                  | Strategy id/name.                              |
| `userName`             | `string`                  | Runtime user.                                  |
| `symbol`               | `string`                  | Current market symbol.                         |
| `config`               | `Record<string, unknown>` | Resolved strategy config.                      |
| `env`                  | `string`                  | Environment, for example `BACKTEST` or `LIVE`. |
| `isConfigFromBacktest` | `boolean`                 | Whether config came from backtest payload.     |
| `decision`             | `SkipDecision             | EntryDecision                                  | ExitDecision` | Decision produced by `core.ts`. |
| `candle`               | `Candle`                  | Current symbol candle.                         |
| `btcCandle`            | `Candle`                  | Current BTC candle.                            |

Decision shapes:

```ts
// SkipDecision
{ kind: 'skip'; code: string }

// ExitDecision
{
  kind: 'exit';
  code: string;
  closePlan: {
    price: number;
    timestamp: number;
    direction: 'LONG' | 'SHORT';
  };
}

// EntryDecision
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
    ml?: { enabled?: boolean; strategyConfig?: Record<string, unknown>; mlThreshold?: number };
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

This hook cannot block runtime flow.
