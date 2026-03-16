---
title: Strategy Runtime Hooks
---

This section documents each lifecycle hook as a separate contract page with explicit input and output shapes.

## Runtime Order

1. [onInit](./on-init) — once, at strategy creation
2. [afterCoreDecision](./after-core-decision) — every candle
3. [onSkip](./on-skip) — only for `skip` decisions
4. [beforeClosePosition](./before-close-position) — **gate**, can block close
5. [afterEnrichMl](./after-enrich-ml) — only when `signal` exists
6. [afterEnrichAi](./after-enrich-ai) — only when `signal` exists
7. [beforeEntryGate](./before-entry-gate) — **gate**, can block entry
8. [beforePlaceOrder](./before-place-order) — right before connector call
9. [afterPlaceOrder](./after-place-order) — after successful order
10. [onRuntimeError](./on-runtime-error) — on any runtime/hook error

## `runtime` Parameter

Entry-path hooks (`afterEnrichMl`, `afterEnrichAi`, `beforeEntryGate`, `beforePlaceOrder`, `afterPlaceOrder`) receive a `runtime` parameter. This is the **resolved** runtime — a merge of manifest defaults, adapter config, and the raw `decision.runtime`:

```ts
runtime = {
  ...manifest.entryRuntimeDefaults,
  ...decision.runtime,
  ml: { ...manifestMlDefaults, ...adapterMl, ...decision.runtime?.ml },
  ai: { ...manifestAiDefaults, ...adapterAi, ...decision.runtime?.ai },
}
```

This means `runtime` is always an object (never `undefined`), and its values may differ from `decision.runtime`. The raw decision runtime is still available via `decision.runtime`.

## Error Handling

Non-blocking hooks (all hooks except `beforeClosePosition` and `beforeEntryGate`) have their errors **swallowed**: if a hook throws, the error is logged, `onRuntimeError` is called, and the runtime flow **continues**. Gate hooks also swallow errors (treated as if the hook returned `undefined`, i.e. execution continues).

## Common Reusable Shapes

Every hook `params` object starts with these fields:

```ts
{
  connector: Connector;
  strategyName: string;
  userName: string;
  symbol: string;
  config: StrategyConfig;
  env: string;
  isConfigFromBacktest: boolean;
}
```

`StrategyConfig` shape:

```ts
{
  BACKTEST_PRICE_MODE?: 'mid' | 'close' | 'open' | 'rand';
  ML_ENABLED?: boolean;
  [key: string]: any;
}
```

`KlineRequest` shape:

```ts
{
  symbol: string;
  interval: string;
  start?: number;
  end: number;
  silent?: boolean;
  cacheOnly?: boolean;
}
```

`KlineChartItem` shape:

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

`Position` shape:

```ts
{
  symbol: string;
  qty: number;
  price: number;
  direction: 'LONG' | 'SHORT';
}
```

`TakeProfit` shape:

```ts
{
  price: number;
  rate: number;
  done?: boolean;
}
```

`StopLoss` shape:

```ts
number | null;
```

`Order` shape:

```ts
{
  symbol: string;
  isLimit?: boolean;
  qty: number;
  price: number;
  timestamp: number;
  direction: 'LONG' | 'SHORT';
  signal?: Signal;
}
```

`ClosePositionOrder` shape:

```ts
{
  symbol: string;
  isLimit?: boolean;
  price: number;
  timestamp: number;
  direction: 'LONG' | 'SHORT';
  signal?: Signal;
}
```

`Ticker` shape:

```ts
{
  symbol: string;
  lastPrice: number;
  indexPrice: number;
  markPrice: number;
  prevPrice24h: number;
  price24hPcnt: number;
  highPrice24h: number;
  lowPrice24h: number;
  prevPrice1h: number;
  openInterest: number;
  openInterestValue: number;
  turnover24h: number;
  volume24h: number;
  fundingRate: number;
  nextFundingTime: number;
  predictedDeliveryPrice: string;
  basisRate: string;
  deliveryFeeRate: string;
  deliveryTime: number;
  ask1Size: number;
  bid1Price: number;
  ask1Price: number;
  bid1Size: number;
  basis: string;
  preOpenPrice: string;
  preQty: string;
}
```

`Signal` shape:

```ts
{
  signalId: string;
  symbol: string;
  interval: string;
  strategy: string;
  direction: 'LONG' | 'SHORT';
  timestamp: number;
  orderStatus?: 'completed' | 'failed' | 'skipped' | 'canceled';
  orderSkipReason?: string;
  isConfigFromBacktest?: boolean;
  ml?: {
    probability: number;
    threshold: number;
    passed: boolean;
  };
  figures: {
    trendLine?: {
      id: string;
      mode: 'lows' | 'highs';
      distance: number;
      touches: Array<{ timestamp: number; value: number }>;
      points: Array<{ timestamp: number; value: number }>;
      alpha?: number[];
    };
    lines?: Array<{
      id?: string;
      kind?: string;
      points: Array<{ timestamp: number; value: number }>;
      color?: string;
      width?: number;
      style?: 'solid' | 'dashed';
    }>;
    points?: Array<{
      id?: string;
      kind?: string;
      points: Array<{ timestamp: number; value: number }>;
      color?: string;
      radius?: number;
    }>;
    zones?: Array<{
      id?: string;
      kind?: string;
      start: { timestamp: number; value: number };
      end: { timestamp: number; value: number };
      color?: string;
      borderColor?: string;
    }>;
    [key: string]: any;
  };
  prices: {
    currentPrice: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    riskRatio: number;
  };
  indicators: Record<string, any>;
  additionalIndicators?: Record<string, any>;
}
```

`Connector` shape:

```ts
{
  kline: (params: KlineRequest) => Promise<KlineChartItem[]>;
  getState: () => Promise<object>;
  setState: (state: object) => Promise<void>;
  getPosition: (symbol: string) => Promise<Position | null>;
  getPositions: () => Promise<Position[]>;
  placeOrder: (order: Order, tp?: TakeProfit[], slPrice?: StopLoss) =>
    Promise<boolean>;
  closePosition: (order: ClosePositionOrder) => Promise<boolean>;
  getTickers: () => Promise<Ticker[]>;
}
```

`ResolvedEntryRuntime` shape (the resolved merge of manifest defaults + adapter config + decision runtime):

```ts
{
  ml?: { enabled?: boolean; strategyConfig?: StrategyConfig; mlThreshold?: number };
  ai?: { enabled?: boolean; minQuality?: number };
  beforePlaceOrder?: () => Promise<void>;
}
```

Gate hooks return this shape when they want to block execution:

```ts
{
  allow?: boolean;
  reason?: string;
}
```
