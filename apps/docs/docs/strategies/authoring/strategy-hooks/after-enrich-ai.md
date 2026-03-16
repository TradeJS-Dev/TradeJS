---
title: afterEnrichAi
---

Called on entry path after AI enrichment. This hook **only fires when `signal` exists** — if the entry decision has no signal, AI enrichment is skipped and this hook is not called.

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
  quality: number | undefined;
}
```

`runtime` is the [resolved entry runtime](./index.md#runtime-parameter) (always an object, never `undefined`). The raw decision runtime is available via `decision.runtime`.

`quality` is the AI quality score returned by the AI enrichment step. It is `undefined` when AI is disabled or the AI request returned no score.

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow. If it throws, the error is logged, `onRuntimeError` is called, and the runtime continues.
