---
title: afterCoreDecision
---

Called right after `core.ts` returns any decision.

## Params

```ts
{
  connector: {
    kline: (params: unknown) => Promise<unknown>;
    getState: () => Promise<Record<string, unknown>>;
    setState: (state: object) => Promise<void>;
    getPosition: (symbol?: string) => Promise<unknown>;
    getPositions: () => Promise<unknown[]>;
    placeOrder: (...args: unknown[]) => Promise<unknown>;
    closePosition: (params: unknown) => Promise<unknown>;
    getTickers: () => Promise<unknown[]>;
  };
  strategyName: string;
  userName: string;
  symbol: string;
  config: Record<string, unknown>;
  env: string;
  isConfigFromBacktest: boolean;
  decision: SkipDecision | EntryDecision | ExitDecision;
  candle: Candle;
  btcCandle: Candle;
}
```

`SkipDecision` shape:

```ts
{ kind: 'skip'; code: string }
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
  };
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
    ml?: { enabled?: boolean; strategyConfig?: Record<string, unknown>; mlThreshold?: number };
    ai?: { enabled?: boolean; minQuality?: number };
    beforePlaceOrder?: () => Promise<void>;
  };
  signal?: Signal;
}
```

Note: `prices` are still part of hook payloads under `decision.entryContext.prices` and `signal.prices`. The API change happened earlier: `strategyApi.entry(...)` no longer accepts `prices`, and runtime derives them itself. The part that did change in the hook contract is `orderPlan`: it now contains only `qty`, `stopLossPrice`, and `takeProfits`.

`Candle` shape:

```ts
{
  timestamp: number;
  dt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}
```

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow.
