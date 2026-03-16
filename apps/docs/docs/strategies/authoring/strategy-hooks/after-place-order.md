---
title: afterPlaceOrder
---

Called on entry path right after successful order placement call. This hook fires for both signal and no-signal entries.

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
  runtime: ResolvedEntryRuntime;
  signal: Signal | undefined;
  orderResult: Signal | string;
}
```

`runtime` is the [resolved entry runtime](./index.md#runtime-parameter) (always an object, never `undefined`). The raw decision runtime is available via `decision.runtime`.

`orderResult` depends on the entry path:
- **With signal:** `orderResult` is the `Signal` object (same reference as `signal`).
- **Without signal:** `orderResult` is the `decision.code` string (e.g. `'ENTRY'`).

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow. If it throws, the error is logged, `onRuntimeError` is called, and the runtime continues.
