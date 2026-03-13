---
title: onInit
---

Вызывается один раз при создании runtime стратегии.

## Вход (`params`)

| Поле                   | Тип                       | Описание                                   |
| ---------------------- | ------------------------- | ------------------------------------------ |
| `connector`            | `object`                  | Экземпляр коннектора биржи.                |
| `strategyName`         | `string`                  | Имя/идентификатор стратегии.               |
| `userName`             | `string`                  | Пользователь runtime.                      |
| `symbol`               | `string`                  | Текущий торговый символ.                   |
| `config`               | `Record<string, unknown>` | Разрешенный конфиг стратегии.              |
| `env`                  | `string`                  | Окружение, например `BACKTEST` или `LIVE`. |
| `isConfigFromBacktest` | `boolean`                 | Конфиг получен из backtest payload.        |
| `data`                 | `Array<Candle>`           | Preload свечей по символу.                 |
| `btcData`              | `Array<Candle>`           | Preload свечей по BTC.                     |

Поля `Candle`: `timestamp: number`, `dt: string`, `open: number`, `high: number`, `low: number`, `close: number`, `volume: number`, `turnover: number`.

## Выход

| Возврат      | Тип                        |
| ------------ | -------------------------- |
| Без значения | `void` или `Promise<void>` |

Этот хук не блокирует выполнение runtime.
