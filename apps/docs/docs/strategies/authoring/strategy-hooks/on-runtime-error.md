---
title: onRuntimeError
---

Called when runtime catches an error in a runtime stage or hook.

## Input (`params`)

| Field                  | Type                      | Description                                    |
| ---------------------- | ------------------------- | ---------------------------------------------- | ------------------------------ | ---------- | ------------------------------------------------ |
| `connector`            | `object`                  | Exchange connector instance.                   |
| `strategyName`         | `string`                  | Strategy id/name.                              |
| `userName`             | `string`                  | Runtime user.                                  |
| `symbol`               | `string`                  | Current market symbol.                         |
| `config`               | `Record<string, unknown>` | Resolved strategy config.                      |
| `env`                  | `string`                  | Environment, for example `BACKTEST` or `LIVE`. |
| `isConfigFromBacktest` | `boolean`                 | Whether config came from backtest payload.     |
| `stage`                | `string`                  | Runtime stage name where error was caught.     |
| `error`                | `unknown`                 | Caught error object/value.                     |
| `decision`             | `SkipDecision             | EntryDecision                                  | ExitDecision                   | undefined` | Decision related to current stage, if available. |
| `signal`               | `Signal                   | undefined`                                     | Signal snapshot, if available. |

Decision shapes:

```ts
{
  kind: 'skip';
  code: string;
}
```

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

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow.
