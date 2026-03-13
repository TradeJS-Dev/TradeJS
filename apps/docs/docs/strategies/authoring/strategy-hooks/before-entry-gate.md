---
title: beforeEntryGate
---

Called on entry path after standard runtime policy checks and before order placement.

## Input (`params`)

| Field                  | Type                      | Description                                    |
| ---------------------- | ------------------------- | ---------------------------------------------- | ----------------------------------------- |
| `connector`            | `object`                  | Exchange connector instance.                   |
| `strategyName`         | `string`                  | Strategy id/name.                              |
| `userName`             | `string`                  | Runtime user.                                  |
| `symbol`               | `string`                  | Current market symbol.                         |
| `config`               | `Record<string, unknown>` | Resolved strategy config.                      |
| `env`                  | `string`                  | Environment, for example `BACKTEST` or `LIVE`. |
| `isConfigFromBacktest` | `boolean`                 | Whether config came from backtest payload.     |
| `decision`             | `EntryDecision`           | Entry decision from `core.ts`.                 |
| `runtime`              | `EntryRuntime             | undefined`                                     | Runtime overrides for this entry.         |
| `signal`               | `Signal                   | undefined`                                     | Enriched signal snapshot (if available).  |
| `quality`              | `number                   | undefined`                                     | AI quality score extracted from analysis. |
| `makeOrdersEnabled`    | `boolean`                 | Current runtime flag for real order execution. |
| `minAiQuality`         | `number`                  | Effective AI quality threshold for this entry. |

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
  ml?: { enabled?: boolean; strategyConfig?: Record<string, unknown>; mlThreshold?: number };
  ai?: { enabled?: boolean; minQuality?: number };
  beforePlaceOrder?: () => Promise<void>;
}
```

`Signal` fields used by runtime:

```ts
{
  signalId: string;
  symbol: string;
  interval: string;
  strategy: string;
  direction: 'LONG' | 'SHORT';
  timestamp: number;
  prices: {
    currentPrice: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    riskRatio: number;
  };
  figures: Record<string, unknown>;
  indicators: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
  ml?: { probability: number; threshold: number; passed: boolean };
}
```

## Output

| Return           | Type                                                                                      | Effect                                            |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Allow/deny entry | `{ allow?: boolean; reason?: string }` or `Promise<{ allow?: boolean; reason?: string }>` | If `allow === false`, entry execution is blocked. |
| No return value  | `void` or `Promise<void>`                                                                 | Entry execution continues.                        |
