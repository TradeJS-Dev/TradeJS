---
title: beforePlaceOrder
---

Called on entry path right before connector order placement. This hook fires for both signal and no-signal entries.

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
  entryContext: EntryContext;
  runtime: ResolvedEntryRuntime;
  signal: Signal | undefined;
}
```

`entryContext` is a convenience shortcut for `decision.entryContext`.

`runtime` is the [resolved entry runtime](./index.md#runtime-parameter) (always an object, never `undefined`). The raw decision runtime is available via `decision.runtime`.

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

This hook cannot block runtime flow. If it throws, the error is logged, `onRuntimeError` is called, and the runtime continues.
