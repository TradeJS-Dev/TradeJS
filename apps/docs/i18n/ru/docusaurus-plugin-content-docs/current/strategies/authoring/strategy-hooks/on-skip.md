---
title: onSkip
---

Вызывается только для решений `skip`.

## Вход (`params`)

| Поле                   | Тип                              | Описание                                   |
| ---------------------- | -------------------------------- | ------------------------------------------ |
| `connector`            | `object`                         | Экземпляр коннектора биржи.                |
| `strategyName`         | `string`                         | Имя/идентификатор стратегии.               |
| `userName`             | `string`                         | Пользователь runtime.                      |
| `symbol`               | `string`                         | Текущий торговый символ.                   |
| `config`               | `Record<string, unknown>`        | Разрешенный конфиг стратегии.              |
| `env`                  | `string`                         | Окружение, например `BACKTEST` или `LIVE`. |
| `isConfigFromBacktest` | `boolean`                        | Конфиг получен из backtest payload.        |
| `decision`             | `{ kind: 'skip'; code: string }` | Skip-решение из `core.ts`.                 |
| `candle`               | `Candle`                         | Текущая свеча по символу.                  |
| `btcCandle`            | `Candle`                         | Текущая свеча по BTC.                      |

## Выход

| Возврат      | Тип                        |
| ------------ | -------------------------- |
| Без значения | `void` или `Promise<void>` |

Этот хук не блокирует выполнение runtime.
