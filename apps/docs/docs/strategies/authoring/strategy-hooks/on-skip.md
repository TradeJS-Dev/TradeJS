---
title: onSkip
---

Called only for `skip` decisions.

## Input (`params`)

| Field                  | Type                             | Description                                    |
| ---------------------- | -------------------------------- | ---------------------------------------------- |
| `connector`            | `object`                         | Exchange connector instance.                   |
| `strategyName`         | `string`                         | Strategy id/name.                              |
| `userName`             | `string`                         | Runtime user.                                  |
| `symbol`               | `string`                         | Current market symbol.                         |
| `config`               | `Record<string, unknown>`        | Resolved strategy config.                      |
| `env`                  | `string`                         | Environment, for example `BACKTEST` or `LIVE`. |
| `isConfigFromBacktest` | `boolean`                        | Whether config came from backtest payload.     |
| `decision`             | `{ kind: 'skip'; code: string }` | Skip decision from `core.ts`.                  |
| `candle`               | `Candle`                         | Current symbol candle.                         |
| `btcCandle`            | `Candle`                         | Current BTC candle.                            |

## Output

| Return          | Type                      |
| --------------- | ------------------------- |
| No return value | `void` or `Promise<void>` |

This hook cannot block runtime flow.
