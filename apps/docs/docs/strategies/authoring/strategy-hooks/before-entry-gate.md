---
title: beforeEntryGate
---

Called on the entry path after standard runtime policy checks are resolved and before order placement. This hook is called for all entry decisions, including no-signal entries.

## Params

```tstype
{
  ctx: StrategyHookCtx;
  market: {
    candle: KlineChartItem;
    btcCandle: KlineChartItem;
  };
  decision: EntryDecision;
  entry: StrategyHookEntryContext;
  policy: StrategyHookPolicyContext;
  ml?: StrategyHookMlContext;
  ai?: StrategyHookAiContext;
}
```

`policy.aiQuality` is `undefined` when there is no signal or AI produced no quality score.

## Output

| Return           | Type                                                                                      | Effect                                            |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Allow/deny entry | `{ allow?: boolean; reason?: string }` or `Promise<{ allow?: boolean; reason?: string }>` | If `allow === false`, entry execution is blocked. |
| No return value  | `void` or `Promise<void>`                                                                 | Entry execution continues.                        |

When the gate blocks (`allow === false`):

- If `entry.signal` exists, runtime sets `signal.orderStatus = 'skipped'` and `signal.orderSkipReason = 'HOOK_BEFORE_ENTRY_GATE:${reason}'` or `HOOK_BEFORE_ENTRY_GATE`.
- If there is no signal, runtime returns the string `HOOK_BEFORE_ENTRY_GATE:${reason}` or `HOOK_BEFORE_ENTRY_GATE`.
