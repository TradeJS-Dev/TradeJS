---
title: onSkip
---

Called only for `skip` decisions.

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
  decision: {
    kind: 'skip';
    code: string;
  };
  candle: Candle;
  btcCandle: Candle;
}
```

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
