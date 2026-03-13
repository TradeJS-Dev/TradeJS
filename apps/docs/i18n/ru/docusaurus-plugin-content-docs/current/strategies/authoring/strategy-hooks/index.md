---
title: Хуки runtime стратегий
---

В этом разделе каждый lifecycle-хук описан отдельной страницей с явными входными и выходными полями.

## Порядок выполнения

1. [onInit](./on-init)
2. [afterCoreDecision](./after-core-decision)
3. [onSkip](./on-skip)
4. [beforeClosePosition](./before-close-position)
5. [afterEnrichMl](./after-enrich-ml)
6. [afterEnrichAi](./after-enrich-ai)
7. [beforeEntryGate](./before-entry-gate)
8. [beforePlaceOrder](./before-place-order)
9. [afterPlaceOrder](./after-place-order)
10. [onRuntimeError](./on-runtime-error)

## Общие поля (есть в каждом `params`)

| Поле                   | Тип                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `connector`            | `object` с методами: `kline`, `getState`, `setState`, `getPosition`, `getPositions`, `placeOrder`, `closePosition`, `getTickers` |
| `strategyName`         | `string`                                                                                                                         |
| `userName`             | `string`                                                                                                                         |
| `symbol`               | `string`                                                                                                                         |
| `config`               | `Record<string, unknown>`                                                                                                        |
| `env`                  | `string`                                                                                                                         |
| `isConfigFromBacktest` | `boolean`                                                                                                                        |

## Общие формы объектов

`candle` / `btcCandle`:

| Поле        | Тип      |
| ----------- | -------- |
| `timestamp` | `number` |
| `dt`        | `string` |
| `open`      | `number` |
| `high`      | `number` |
| `low`       | `number` |
| `close`     | `number` |
| `volume`    | `number` |
| `turnover`  | `number` |

`StrategyHookGateResult`:

| Поле     | Тип       | Обязательно |
| -------- | --------- | ----------- |
| `allow`  | `boolean` | Нет         |
| `reason` | `string`  | Нет         |
