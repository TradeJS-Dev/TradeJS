---
title: Strategy Runtime Hooks
---

This section documents each lifecycle hook as a separate contract page with explicit input and output shapes.

## Runtime Order

1. [onInit](./on-init)
2. [afterCoreDecision](./after-core-decision)
3. [onSkip](./on-skip)
4. [beforeClosePosition](./before-close-position)
5. [afterEnrichMl](./after-enrich-ml)
6. [afterEnrichAi](./after-enrich-ai)
7. [beforeEntryGate](./before-entry-gate)
8. [beforePlaceOrder](./before-place-order)
9. [afterPlaceOrder](./after-place-order)
10. [onRuntimeError](./on-runtime-error)

## Common Base Shape

Every hook `params` object starts with these fields:

```ts
{
  connector: {
    kline: (params: unknown) => Promise<unknown>;
    getState: () => Promise<Record<string, unknown>>;
    setState: (state: object) => Promise<void>;
    getPosition: (symbol?: string) => Promise<unknown>;
    getPositions: () => Promise<unknown[]>;
    placeOrder: (...args: unknown[]) => Promise<unknown>;
    closePosition: (params: unknown) => Promise<unknown>;
    getTickers: () => Promise<unknown[]>;
  }
  strategyName: string;
  userName: string;
  symbol: string;
  config: Record<string, unknown>;
  env: string;
  isConfigFromBacktest: boolean;
}
```

`candle`, `btcCandle`, and preload arrays use this shape:

```ts
{
  timestamp: number;
  dt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}
```

Gate hooks return this shape when they want to block execution:

```ts
{
  allow?: boolean;
  reason?: string;
}
```
