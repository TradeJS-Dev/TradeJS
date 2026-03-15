---
title: Хуки runtime стратегий
---

В этом разделе каждый lifecycle-хук описан отдельной страницей с явными shape-блоками для входа и выхода.

## Порядок выполнения

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

## Общие переиспользуемые shape-ы

Каждый объект `params` начинается с этих полей:

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

Gate-хуки возвращают такую форму, если хотят заблокировать исполнение:

```ts
{
  allow?: boolean;
  reason?: string;
}
```
