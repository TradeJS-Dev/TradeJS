---
title: onRuntimeError
---

Called when runtime catches an error in a runtime stage or hook.

## Params

```ts
type Params = {
  ctx: StrategyHookCtx;
  market?: StrategyHookMarketContext;
  decision?: StrategyDecision;
  entry?: StrategyHookEntryContext;
  error: {
    stage: StrategyHookStage;
    cause: unknown;
  };
};
```

`market`, `decision`, and `entry` are optional because some failures happen before all stage-specific context exists.

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow. If `onRuntimeError` itself throws, the error is logged but not re-thrown.
