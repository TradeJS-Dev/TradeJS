---
title: afterCoreDecision
---

Вызывается сразу после того, как `core.ts` вернул любое решение.

## Параметры

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
  };
  strategyName: string;
  userName: string;
  symbol: string;
  config: Record<string, unknown>;
  env: string;
  isConfigFromBacktest: boolean;
  decision: SkipDecision | EntryDecision | ExitDecision;
  candle: Candle;
  btcCandle: Candle;
}
```

`SkipDecision` shape:

```ts
{ kind: 'skip'; code: string }
```

`ExitDecision` shape:

```ts
{
  kind: 'exit';
  code: string;
  closePlan: {
    price: number;
    timestamp: number;
    direction: 'LONG' | 'SHORT';
  };
}
```

`EntryDecision` shape:

```ts
{
  kind: 'entry';
  code: string;
  entryContext: {
    strategy: string;
    symbol: string;
    interval: string;
    direction: 'LONG' | 'SHORT';
    timestamp: number;
    prices: {
      currentPrice: number;
      takeProfitPrice: number;
      stopLossPrice: number;
      riskRatio: number;
    };
    isConfigFromBacktest?: boolean;
  };
  orderPlan: {
    qty: number;
    stopLossPrice: number;
    takeProfits: Array<{ price: number; rate: number; done?: boolean }>;
  };
  runtime?: {
    ml?: { enabled?: boolean; strategyConfig?: Record<string, unknown>; mlThreshold?: number };
    ai?: { enabled?: boolean; minQuality?: number };
    beforePlaceOrder?: () => Promise<void>;
  };
  signal?: Signal;
}
```

Важно: `prices` по-прежнему есть в hook payload-ах внутри `decision.entryContext.prices` и `signal.prices`. Мы убирали их из входа `strategyApi.entry(...)`, а рантайм теперь вычисляет их сам. Что реально изменилось в hook-контракте — это `orderPlan`: теперь там только `qty`, `stopLossPrice` и `takeProfits`.

`Candle` shape:

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

## Выход

| Возврат      | Тип                        |
| ------------ | -------------------------- |
| Без значения | `void` или `Promise<void>` |

Этот хук не блокирует выполнение runtime.
