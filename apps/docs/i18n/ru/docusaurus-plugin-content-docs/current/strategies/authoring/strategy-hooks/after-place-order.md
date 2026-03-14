---
title: afterPlaceOrder
---

Вызывается в entry-path сразу после успешного вызова постановки ордера.

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
  }
  strategyName: string;
  userName: string;
  symbol: string;
  config: Record<string, unknown>;
  env: string;
  isConfigFromBacktest: boolean;
  decision: EntryDecision;
  runtime: EntryRuntime | undefined;
  signal: Signal | undefined;
  orderResult: unknown;
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
  runtime?: EntryRuntime;
  signal?: Signal;
}
```

`EntryRuntime` shape:

```ts
{
  ml?: { enabled?: boolean; strategyConfig?: Record<string, unknown>; mlThreshold?: number };
  ai?: { enabled?: boolean; minQuality?: number };
  beforePlaceOrder?: () => Promise<void>;
}
```

Важно: `prices` по-прежнему есть в hook payload-ах внутри `decision.entryContext.prices` и `signal.prices`. Мы убирали их из входа `strategyApi.entry(...)`, а рантайм теперь вычисляет их сам. Что реально изменилось в hook-контракте — это `orderPlan`: теперь там только `qty`, `stopLossPrice` и `takeProfits`.

`Signal`, передаваемый в хук:

```ts
{
  signalId: string;
  symbol: string;
  interval: string;
  strategy: string;
  direction: 'LONG' | 'SHORT';
  timestamp: number;
  prices: {
    currentPrice: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    riskRatio: number;
  };
  figures: Record<string, unknown>;
  indicators: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
  ml?: { probability: number; threshold: number; passed: boolean };
}
```

## Выход

| Возврат      | Тип                        |
| ------------ | -------------------------- |
| Без значения | `void` или `Promise<void>` |

Этот хук не блокирует выполнение runtime.
