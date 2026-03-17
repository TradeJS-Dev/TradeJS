---
title: beforeClosePosition
---

Called on the exit path before `connector.closePosition(...)`.

## Params

```ts
type Params = {
  ctx: StrategyHookCtx;
  market: {
    candle: KlineChartItem;
    btcCandle: KlineChartItem;
  };
  decision: ExitDecision;
};
```

## Output

| Return           | Type                                                                                      | Effect                                            |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Allow/deny close | `{ allow?: boolean; reason?: string }` or `Promise<{ allow?: boolean; reason?: string }>` | If `allow === false`, close execution is blocked. |
| No return value  | `void` or `Promise<void>`                                                                 | Close execution continues.                        |

When the gate blocks (`allow === false`), the runtime returns `CLOSE_BLOCKED_BY_HOOK:${reason}` or `CLOSE_BLOCKED_BY_HOOK`.
