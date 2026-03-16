---
title: beforeEntryGate
---

Called on entry path after standard runtime policy checks (AI quality, `MAKE_ORDERS`) pass, and before order placement. This hook is called for **all** entry decisions, regardless of whether `signal` exists.

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
  quality: number | undefined;
  makeOrdersEnabled: boolean;
  minAiQuality: number;
}
```

`runtime` is the [resolved entry runtime](./index.md#runtime-parameter) (always an object, never `undefined`). The raw decision runtime is available via `decision.runtime`.

`minAiQuality` is resolved from `runtime.ai?.minQuality` with a **default of 4** when not specified.

`quality` is `undefined` when there is no signal or AI enrichment returned no score.

## Output

| Return           | Type                                                                                      | Effect                                            |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Allow/deny entry | `{ allow?: boolean; reason?: string }` or `Promise<{ allow?: boolean; reason?: string }>` | If `allow === false`, entry execution is blocked. |
| No return value  | `void` or `Promise<void>`                                                                 | Entry execution continues.                        |

When the gate blocks (`allow === false`):
- If `signal` exists: `signal.orderStatus` is set to `'skipped'` and `signal.orderSkipReason` is set to `'HOOK_BEFORE_ENTRY_GATE:${reason}'` (or `'HOOK_BEFORE_ENTRY_GATE'` if no reason).
- If no signal: the runtime returns the string `'HOOK_BEFORE_ENTRY_GATE:${reason}'` (or `'HOOK_BEFORE_ENTRY_GATE'`).
