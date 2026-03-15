---
title: beforeEntryGate
---

Called on entry path after standard runtime policy checks and before order placement.

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
  decision: EntryDecision;
  runtime: EntryRuntime | undefined;
  signal: Signal | undefined;
  quality: number | undefined;
  makeOrdersEnabled: boolean;
  minAiQuality: number;
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
  runtime?: EntryRuntime;
  signal?: Signal;
}
```

`EntryRuntime` shape:

```ts
{
  ml?: { enabled?: boolean; strategyConfig?: StrategyConfig; mlThreshold?: number };
  ai?: { enabled?: boolean; minQuality?: number };
  beforePlaceOrder?: () => Promise<void>;
}
```

## Output

| Return           | Type                                                                                      | Effect                                            |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Allow/deny entry | `{ allow?: boolean; reason?: string }` or `Promise<{ allow?: boolean; reason?: string }>` | If `allow === false`, entry execution is blocked. |
| No return value  | `void` or `Promise<void>`                                                                 | Entry execution continues.                        |
