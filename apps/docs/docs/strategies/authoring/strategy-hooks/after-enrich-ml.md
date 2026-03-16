---
title: afterEnrichMl
---

Called on entry path after ML enrichment. This hook **only fires when `signal` exists** — if the entry decision has no signal, ML enrichment is skipped and this hook is not called.

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
  signal: Signal;
}
```

`runtime` is the [resolved entry runtime](./index.md#runtime-parameter) (always an object, never `undefined`). The raw decision runtime is available via `decision.runtime`.

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow. If it throws, the error is logged, `onRuntimeError` is called, and the runtime continues.
