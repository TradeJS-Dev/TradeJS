---
title: beforePlaceOrder
---

Вызывается в entry-path прямо перед постановкой ордера через коннектор.

## Вход (`params`)

| Поле                   | Тип                       | Описание                                     |
| ---------------------- | ------------------------- | -------------------------------------------- | ----------------------------------------- |
| `connector`            | `object`                  | Экземпляр коннектора биржи.                  |
| `strategyName`         | `string`                  | Имя/идентификатор стратегии.                 |
| `userName`             | `string`                  | Пользователь runtime.                        |
| `symbol`               | `string`                  | Текущий торговый символ.                     |
| `config`               | `Record<string, unknown>` | Разрешенный конфиг стратегии.                |
| `env`                  | `string`                  | Окружение, например `BACKTEST` или `LIVE`.   |
| `isConfigFromBacktest` | `boolean`                 | Конфиг получен из backtest payload.          |
| `decision`             | `EntryDecision`           | Entry-решение из `core.ts`.                  |
| `entryContext`         | `EntryContext`            | Финальный execution context для этого entry. |
| `runtime`              | `EntryRuntime             | undefined`                                   | Runtime overrides для этого entry.        |
| `signal`               | `Signal                   | undefined`                                   | Enriched signal snapshot (если доступен). |

`EntryContext`:

```ts
{
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
}
```

## Выход

| Возврат      | Тип                        |
| ------------ | -------------------------- |
| Без значения | `void` или `Promise<void>` |

Этот хук не блокирует выполнение runtime.
