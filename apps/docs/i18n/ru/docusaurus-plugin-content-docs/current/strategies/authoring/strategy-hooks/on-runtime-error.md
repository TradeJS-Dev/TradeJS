---
title: onRuntimeError
---

Вызывается, когда runtime перехватывает ошибку на любом этапе или в хуках.

## Вход (`params`)

| Поле                   | Тип                       | Описание                                   |
| ---------------------- | ------------------------- | ------------------------------------------ | ------------------------------ | ---------- | -------------------------------------- |
| `connector`            | `object`                  | Экземпляр коннектора биржи.                |
| `strategyName`         | `string`                  | Имя/идентификатор стратегии.               |
| `userName`             | `string`                  | Пользователь runtime.                      |
| `symbol`               | `string`                  | Текущий торговый символ.                   |
| `config`               | `Record<string, unknown>` | Разрешенный конфиг стратегии.              |
| `env`                  | `string`                  | Окружение, например `BACKTEST` или `LIVE`. |
| `isConfigFromBacktest` | `boolean`                 | Конфиг получен из backtest payload.        |
| `stage`                | `string`                  | Имя runtime-stage, где поймана ошибка.     |
| `error`                | `unknown`                 | Перехваченная ошибка/значение.             |
| `decision`             | `SkipDecision             | EntryDecision                              | ExitDecision                   | undefined` | Решение текущего этапа, если доступно. |
| `signal`               | `Signal                   | undefined`                                 | Снимок сигнала, если доступен. |

Формы `decision`:

```ts
{
  kind: 'skip';
  code: string;
}
```

```ts
{
  kind: 'exit';
  code: string;
  closePlan: {
    price: number;
    timestamp: number;
    direction: 'LONG' | 'SHORT';
  }
}
```

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
}
```

`Signal` (поля, используемые runtime):

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
