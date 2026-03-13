---
title: afterCoreDecision
---

Вызывается сразу после того, как `core.ts` вернул любое решение.

## Вход (`params`)

| Поле                   | Тип                       | Описание                                   |
| ---------------------- | ------------------------- | ------------------------------------------ | ------------- | --------------------- |
| `connector`            | `object`                  | Экземпляр коннектора биржи.                |
| `strategyName`         | `string`                  | Имя/идентификатор стратегии.               |
| `userName`             | `string`                  | Пользователь runtime.                      |
| `symbol`               | `string`                  | Текущий торговый символ.                   |
| `config`               | `Record<string, unknown>` | Разрешенный конфиг стратегии.              |
| `env`                  | `string`                  | Окружение, например `BACKTEST` или `LIVE`. |
| `isConfigFromBacktest` | `boolean`                 | Конфиг получен из backtest payload.        |
| `decision`             | `SkipDecision             | EntryDecision                              | ExitDecision` | Решение из `core.ts`. |
| `candle`               | `Candle`                  | Текущая свеча по символу.                  |
| `btcCandle`            | `Candle`                  | Текущая свеча по BTC.                      |

Формы решений:

```ts
// SkipDecision
{ kind: 'skip'; code: string }

// ExitDecision
{
  kind: 'exit';
  code: string;
  closePlan: {
    price: number;
    timestamp: number;
    direction: 'LONG' | 'SHORT';
  };
}

// EntryDecision
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

## Выход

| Возврат      | Тип                        |
| ------------ | -------------------------- |
| Без значения | `void` или `Promise<void>` |

Этот хук не блокирует выполнение runtime.
