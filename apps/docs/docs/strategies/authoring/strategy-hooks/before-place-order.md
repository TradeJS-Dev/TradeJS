---
title: beforePlaceOrder
---

Called on entry path right before connector order placement.

## Input (`params`)

| Field                  | Type                      | Description                                    |
| ---------------------- | ------------------------- | ---------------------------------------------- | ---------------------------------------- |
| `connector`            | `object`                  | Exchange connector instance.                   |
| `strategyName`         | `string`                  | Strategy id/name.                              |
| `userName`             | `string`                  | Runtime user.                                  |
| `symbol`               | `string`                  | Current market symbol.                         |
| `config`               | `Record<string, unknown>` | Resolved strategy config.                      |
| `env`                  | `string`                  | Environment, for example `BACKTEST` or `LIVE`. |
| `isConfigFromBacktest` | `boolean`                 | Whether config came from backtest payload.     |
| `decision`             | `EntryDecision`           | Entry decision from `core.ts`.                 |
| `entryContext`         | `EntryContext`            | Final execution context for this entry.        |
| `runtime`              | `EntryRuntime             | undefined`                                     | Runtime overrides for this entry.        |
| `signal`               | `Signal                   | undefined`                                     | Enriched signal snapshot (if available). |

`EntryContext` shape:

```ts
{
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
}
```

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow.
