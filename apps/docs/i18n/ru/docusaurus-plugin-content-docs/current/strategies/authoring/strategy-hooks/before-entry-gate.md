---
title: beforeEntryGate
---

Вызывается в entry-path после стандартных policy-проверок runtime и до постановки ордера.

## Параметры

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
  runtime: EntryRuntime | undefined;
  signal: Signal | undefined;
  quality: number | undefined;
  makeOrdersEnabled: boolean;
  minAiQuality: number;
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
  ml?: { enabled?: boolean; strategyConfig?: StrategyConfig; mlThreshold?: number };
  ai?: { enabled?: boolean; minQuality?: number };
  beforePlaceOrder?: () => Promise<void>;
}
```

## Выход

| Возврат                  | Тип                                                                                        | Эффект                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Разрешить/запретить вход | `{ allow?: boolean; reason?: string }` или `Promise<{ allow?: boolean; reason?: string }>` | Если `allow === false`, entry блокируется. |
| Без значения             | `void` или `Promise<void>`                                                                 | Entry продолжается.                        |
