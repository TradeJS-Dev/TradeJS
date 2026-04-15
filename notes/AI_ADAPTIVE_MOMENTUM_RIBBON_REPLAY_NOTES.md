# AI AdaptiveMomentumRibbon Replay Notes

Last updated: 2026-04-15

## Goal

Подготовить `AdaptiveMomentumRibbon` к циклу:

1. `yarn backtest -c AdaptiveMomentumRibbon:ai --ai`
2. `yarn ai-export`
3. `yarn ai-train --strategy AdaptiveMomentumRibbon -n 500 --localOnly`

## Preparation Done

- Добавлен strategy-specific AI adapter для `AdaptiveMomentumRibbon`.
- В payload теперь пишется `adaptiveMomentumRibbonContext`.
- Добавлен deterministic gate для local replay / `ai-train --localOnly`.
- В signal теперь пишутся:
  - `amrSignalTiming`
  - `amrConfigSnapshot`

## Current AI Context

`adaptiveMomentumRibbonContext` включает:

- `signalOsc`
- `oscillatorStrength`
- `channelState`
- `channelBiasAligned`
- `invalidationDistancePct`
- `structuralRewardRiskRatio`
- `coinBiasAligned`
- `btcBiasAligned`
- `deterministicQuality`
- `approvalAllowedNow`
- `structuralHardBlockReasons`

## Current Deterministic Logic

Hard block:

- `invalidated`
- `inactive_signal_state`
- `oscillator_conflict`
- `invalidation_wrong_side`

Quality model:

- `q5`
  - сильный zero-cross
  - цена на правильной сильной стороне Keltner channel
  - compact invalidation
  - хороший structural reward/risk
  - без конфликтов по coin/BTC bias
- `q4`
  - momentum подтвержден
  - цена не на плохой стороне midline
  - invalidation и structural risk остаются sane
  - нет двойного bias-conflict
- `q3`
  - сетап существует, но для live approval пока слишком слабый
- `q2`
  - signal structurally broken

## First Research Pass

Начинать с baseline без широкого grid:

```json
{
  "LONG": [
    {
      "enable": true,
      "direction": "LONG",
      "TP": 2,
      "SL": 1
    }
  ],
  "SHORT": [
    {
      "enable": true,
      "direction": "SHORT",
      "TP": 2,
      "SL": 1
    }
  ]
}
```

Если baseline даст слишком мало сделок, следующая осмысленная сетка:

```json
{
  "AMR_MOMENTUM_PERIOD": [16, 20, 24],
  "AMR_BUTTERWORTH_SMOOTHING": [2, 3, 4],
  "AMR_ATR_MULTIPLIER": [1.5, 2, 2.5],
  "LONG": [
    {
      "enable": true,
      "direction": "LONG",
      "TP": 1.8,
      "SL": 0.9
    },
    {
      "enable": true,
      "direction": "LONG",
      "TP": 2,
      "SL": 1
    }
  ],
  "SHORT": [
    {
      "enable": true,
      "direction": "SHORT",
      "TP": 1.8,
      "SL": 0.9
    },
    {
      "enable": true,
      "direction": "SHORT",
      "TP": 2,
      "SL": 1
    }
  ]
}
```

## What To Inspect First In AI Train

- `TP / FP / TN / FN`
- pockets by direction: `LONG` vs `SHORT`
- how many approvals come from:
  - `channelState=above_upper / below_lower`
  - `channelState=inside_channel`
  - bias-aligned vs conflict lanes
- whether `q5` is too generous
- whether `SHORT` needs to be stricter than `LONG`

## Initial Risks

- Strategy is same-bar zero-cross driven, so there is no natural multi-stage confirmation like in `VolumeDivergence`.
- Because of that, AI layer can easily overfit to oscillator strength alone.
- The first thing to verify is whether approved stream remains positive on:
  - `latest 500`
  - `skip 500`
  - `skip 1000`
