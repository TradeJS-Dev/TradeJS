---
title: Strategy Runtime Hooks
---

This section documents each lifecycle hook as a separate contract page with explicit input/output fields.

## Runtime Order

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

## Common Base Fields

These fields are present in every hook `params` object:

| Field                  | Type                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `connector`            | `object` with methods: `kline`, `getState`, `setState`, `getPosition`, `getPositions`, `placeOrder`, `closePosition`, `getTickers` |
| `strategyName`         | `string`                                                                                                                           |
| `userName`             | `string`                                                                                                                           |
| `symbol`               | `string`                                                                                                                           |
| `config`               | `Record<string, unknown>`                                                                                                          |
| `env`                  | `string`                                                                                                                           |
| `isConfigFromBacktest` | `boolean`                                                                                                                          |

## Shared Object Shapes

`candle` / `btcCandle` items use this shape:

| Field       | Type     |
| ----------- | -------- |
| `timestamp` | `number` |
| `dt`        | `string` |
| `open`      | `number` |
| `high`      | `number` |
| `low`       | `number` |
| `close`     | `number` |
| `volume`    | `number` |
| `turnover`  | `number` |

`StrategyHookGateResult` shape:

| Field    | Type      | Required |
| -------- | --------- | -------- |
| `allow`  | `boolean` | No       |
| `reason` | `string`  | No       |
