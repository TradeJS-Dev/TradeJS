---
title: onInit
---

Called once when strategy runtime is created.

## Input (`params`)

| Field                  | Type                      | Description                                    |
| ---------------------- | ------------------------- | ---------------------------------------------- |
| `connector`            | `object`                  | Exchange connector instance.                   |
| `strategyName`         | `string`                  | Strategy id/name.                              |
| `userName`             | `string`                  | Runtime user.                                  |
| `symbol`               | `string`                  | Current market symbol.                         |
| `config`               | `Record<string, unknown>` | Resolved strategy config.                      |
| `env`                  | `string`                  | Environment, for example `BACKTEST` or `LIVE`. |
| `isConfigFromBacktest` | `boolean`                 | Whether config came from backtest payload.     |
| `data`                 | `Array<Candle>`           | Symbol candles preload.                        |
| `btcData`              | `Array<Candle>`           | BTC candles preload.                           |

`Candle` fields: `timestamp: number`, `dt: string`, `open: number`, `high: number`, `low: number`, `close: number`, `volume: number`, `turnover: number`.

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow.
