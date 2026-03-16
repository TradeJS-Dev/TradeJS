---
title: Strategy Runtime Hooks
---

This section documents the lifecycle hook contract used by the shared strategy runtime.

## Runtime Order

1. [onInit](./on-init) — once, at strategy creation
2. [afterCoreDecision](./after-core-decision) — every candle
3. [onSkip](./on-skip) — only for `skip` decisions
4. [beforeClosePosition](./before-close-position) — gate, can block close
5. [afterEnrichMl](./after-enrich-ml) — only when `decision.signal` exists
6. [afterEnrichAi](./after-enrich-ai) — only when `decision.signal` exists
7. [beforeEntryGate](./before-entry-gate) — gate, can block entry
8. [beforePlaceOrder](./before-place-order) — right before connector order placement
9. [afterPlaceOrder](./after-place-order) — after successful order placement
10. [onRuntimeError](./on-runtime-error) — on any runtime or hook error

## Canonical Params Shape

Every hook now receives a stage-specific subset of the same nested object:

```ts
{
  ctx?: StrategyHookCtx;
  market?: StrategyHookMarketContext;
  decision?: StrategyDecision;
  entry?: StrategyHookEntryContext;
  ml?: StrategyHookMlContext;
  ai?: StrategyHookAiContext;
  policy?: StrategyHookPolicyContext;
  order?: StrategyHookOrderContext;
  error?: StrategyHookErrorPayload;
}
```

## Common Nested Shapes

`ctx`:

```ts
{
  connector: Connector;
  strategyName: string;
  userName: string;
  symbol: string;
  strategyConfig: StrategyConfig;
  env: string;
  isConfigFromBacktest: boolean;
}
```

`market`:

```ts
{
  candle?: KlineChartItem;
  btcCandle?: KlineChartItem;
  data?: KlineChartItem[];
  btcData?: KlineChartItem[];
}
```

`entry`:

```ts
{
  context: StrategyEntrySignalContext;
  orderPlan: StrategyEntryOrderPlan;
  signal?: Signal;
  runtime: {
    raw?: StrategyEntryRuntimeOptions;
    resolved: StrategyEntryRuntimeOptions;
  };
}
```

`ml`:

```ts
{
  config?: StrategyRuntimeMlOptions;
  attempted: boolean;
  applied: boolean;
  result?: Signal['ml'];
  skippedReason?:
    | 'BACKTEST'
    | 'DISABLED'
    | 'NO_RUNTIME'
    | 'NO_STRATEGY_CONFIG'
    | 'NO_THRESHOLD'
    | 'NO_RESULT';
}
```

`ai`:

```ts
{
  config?: StrategyRuntimeAiOptions;
  attempted: boolean;
  applied: boolean;
  quality?: number;
  skippedReason?: 'BACKTEST' | 'DISABLED' | 'NO_RUNTIME' | 'NO_QUALITY';
}
```

`policy`:

```ts
{
  aiQuality?: number;
  makeOrdersEnabled: boolean;
  minAiQuality: number;
}
```

`order`:

```ts
{
  result: Signal | string;
}
```

`error`:

```ts
{
  stage: StrategyHookStage;
  cause: unknown;
}
```

Gate hooks return this shape when they want to block execution:

```ts
{
  allow?: boolean;
  reason?: string;
}
```

## Important Notes

- `entry.runtime.raw` is the raw runtime returned by `core.ts` through `strategyApi.entry(...)`.
- `entry.runtime.resolved` is the runtime actually used by the shared runtime after merging manifest defaults, adapter config, and the raw decision runtime.
- `afterEnrichMl` is about the ML stage, not only ML success. Use `ml.attempted`, `ml.applied`, and `ml.skippedReason` to tell whether ML actually ran.
- `afterEnrichAi` uses the same pattern for AI with the `ai` object.
- Non-blocking hooks swallow errors: the runtime logs the failure, calls `onRuntimeError`, and continues.
- Gate hooks (`beforeClosePosition`, `beforeEntryGate`) also swallow their own errors; if they throw, runtime behaves as if the hook returned `undefined`.
