---
title: 'Стратегия: AdaptiveMomentumRibbon'
---

`AdaptiveMomentumRibbon` — Pine-стратегия как отдельная самостоятельная стратегия (`packages/core/src/strategy/AdaptiveMomentumRibbon`).

Исходник Pine:

- `packages/core/src/strategy/AdaptiveMomentumRibbon/adaptiveMomentumRibbon.pine`

Runtime передает в `core.ts` загрузчик скрипта (`loadPineScript`), поэтому Pine-логика хранится отдельно и обновляется независимо от TypeScript-кода.

## Логика входа

1. `core.ts` загружает Pine-код через `loadPineScript('adaptiveMomentumRibbon.pine')`.
2. Берет последние свечи (`AMR_LOOKBACK_BARS`) и выполняет Pine через `runPineScript`.
3. Читает последние значения plot:

- `entryLong`, `entryShort`
- `invalidated`, `activeBuy`, `activeSell`
- `signalOsc`, `kcMidline`, `kcUpper`, `kcLower`, `invalidationLevel`

4. Если оба `entry` одновременно `true`, делает skip (конфликт).
5. Если позиция уже открыта:

- закрывает по противоположному сигналу
- опционально закрывает по invalidation (`AMR_EXIT_ON_INVALIDATION`)

6. Если позиции нет и сигнал валидный:

- применяет side-конфиг (`LONG` или `SHORT`)
- считает TP/SL/qty
- возвращает `entry`

## Выходы

- `CLOSE_BY_AMR_SIGNAL` — противоположный сигнал
- `CLOSE_BY_AMR_INVALIDATION` — invalidation при `AMR_EXIT_ON_INVALIDATION=true`

## Параметры конфига (что означает каждый)

### Общие runtime-параметры

- `ENV` — режим запуска.
- `INTERVAL` — таймфрейм.
- `MAKE_ORDERS` — выполнять ордера или только считать сигналы.
- `BACKTEST_PRICE_MODE` — режим цены исполнения в бэктесте.

### AI/ML-параметры

- `AI_ENABLED` — включает AI enrichment/gating.
- `MIN_AI_QUALITY` — минимальное качество AI.
- `ML_ENABLED` — включает ML enrichment.
- `ML_THRESHOLD` — порог ML-оценки.

### Параметры Pine-модели AMR

- `AMR_MOMENTUM_PERIOD` — `Momentum Period` в Pine.
- `AMR_BUTTERWORTH_SMOOTHING` — `Butterworth Smoothing` в Pine.
- `AMR_WAIT_CLOSE` — подтверждать сигналы только на закрытии свечи.
- `AMR_SHOW_INVALIDATION_LEVELS` — рисовать invalidation-уровни.
- `AMR_SHOW_KELTNER_CHANNEL` — рисовать Keltner Channel.
- `AMR_KC_LENGTH` — период Keltner midline.
- `AMR_KC_MA_TYPE` — тип MA для midline (`SMA`, `EMA`, `SMMA (RMA)`, `WMA`, `VWMA`).
- `AMR_ATR_LENGTH` — период ATR для Keltner.
- `AMR_ATR_MULTIPLIER` — множитель ATR для Keltner bands.

### Параметры исполнения/визуализации

- `AMR_LOOKBACK_BARS` — сколько свечей передавать в Pine на один расчет.
- `AMR_EXIT_ON_INVALIDATION` — закрывать позицию по invalidation-сигналу.
- `AMR_LINE_PLOTS` — какие plot-линии переносить в `figures.lines`.
- `CLOSE_OPPOSITE_POSITIONS` — поле есть в конфиге по общему шаблону, текущий `AdaptiveMomentumRibbon` hook-логику по нему не использует.

### Параметры сценария `LONG`

- `LONG.enable` — включить/выключить long-сценарий.
- `LONG.direction` — направление ордера (`LONG`).
- `LONG.TP` — take-profit в процентах.
- `LONG.SL` — stop-loss в процентах.

### Параметры сценария `SHORT`

- `SHORT.enable` — включить/выключить short-сценарий.
- `SHORT.direction` — направление ордера (`SHORT`).
- `SHORT.TP` — take-profit в процентах.
- `SHORT.SL` — stop-loss в процентах.

## Используемые индикаторы (что означает каждый)

### Pine-серии, которые использует стратегия

- `entryLong`, `entryShort` — бинарные входные сигналы.
- `activeBuy`, `activeSell` — состояние активного buy/sell контекста.
- `invalidated` — флаг инвалидированного сигнала.
- `signalOsc` — сглаженный осциллятор AMR (центр вокруг 0).
- `kcMidline` — центральная линия Keltner.
- `kcUpper` — верхняя граница Keltner.
- `kcLower` — нижняя граница Keltner.
- `invalidationLevel` — текущий invalidation-уровень.

### Линии в figures

- все серии из `AMR_LINE_PLOTS` добавляются в `figures.lines`
- это позволяет выбирать, какие Pine-линии отображать в UI и в бэктест-чартах

## Payload сигнала

`figures`:

- линии по `AMR_LINE_PLOTS`
- точка входа

`additionalIndicators.amr`:

- `entryLong`, `entryShort`, `activeBuy`, `activeSell`, `invalidated`
- `signalOsc`
- значения KC и invalidation-уровня
- `lineValues` по выбранным plot

## Пример runtime-конфига

```json
{
  "ENV": "CRON",
  "INTERVAL": "15",
  "AMR_LOOKBACK_BARS": 400,
  "AMR_MOMENTUM_PERIOD": 20,
  "AMR_BUTTERWORTH_SMOOTHING": 3,
  "AMR_WAIT_CLOSE": true,
  "AMR_KC_LENGTH": 20,
  "AMR_KC_MA_TYPE": "EMA",
  "AMR_ATR_LENGTH": 14,
  "AMR_ATR_MULTIPLIER": 2,
  "AMR_EXIT_ON_INVALIDATION": true,
  "AMR_LINE_PLOTS": ["kcMidline", "kcUpper", "kcLower", "invalidationLevel"],
  "LONG": { "enable": true, "direction": "LONG", "TP": 2, "SL": 1 },
  "SHORT": { "enable": true, "direction": "SHORT", "TP": 2, "SL": 1 }
}
```

## Запуск

```bash
yarn backtest --user root --config AdaptiveMomentumRibbon:amr-default --connector bybit --timeframe 15
yarn signals --user root --timeframe 15
```
