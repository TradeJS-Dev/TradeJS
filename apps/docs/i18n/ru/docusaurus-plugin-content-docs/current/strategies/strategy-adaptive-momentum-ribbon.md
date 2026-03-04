---
title: 'Стратегия: AdaptiveMomentumRibbon (референс)'
---

`AdaptiveMomentumRibbon` — Pine-стратегия как отдельная самостоятельная стратегия (`packages/core/src/strategy/AdaptiveMomentumRibbon`).

Исходник Pine:

- `packages/core/src/strategy/AdaptiveMomentumRibbon/adaptiveMomentumRibbon.pine`

Runtime передает в core загрузчик скрипта (`loadPineScript`), поэтому Pine-логика хранится и поддерживается отдельно.

## Логика входа

1. `core.ts` загружает Pine-код через `loadPineScript('adaptiveMomentumRibbon.pine')`.
2. Берет последние свечи (`AMR_LOOKBACK_BARS`) и выполняет Pine через `runPineScript`.
3. Читает последние значения plot:

- `entryLong`, `entryShort`
- `invalidated`, `activeBuy`, `activeSell`
- `signalOsc`, KC-линии, `invalidationLevel`

4. Если оба entry plot = `true`, стратегия делает skip (конфликт).
5. Если есть позиция:

- закрывает по противоположному сигналу
- опционально по invalidation (`AMR_EXIT_ON_INVALIDATION`)

6. Если позиции нет и сигнал валидный:

- применяет side-конфиг (`LONG` или `SHORT`)
- считает TP/SL/qty и возвращает `entry`.

## Выходы

- `CLOSE_BY_AMR_SIGNAL` при противоположном сигнале
- `CLOSE_BY_AMR_INVALIDATION` при invalidation и `AMR_EXIT_ON_INVALIDATION=true`

## Параметры конфига

Маппинг в Pine inputs:

- `AMR_MOMENTUM_PERIOD` -> `Momentum Period`
- `AMR_BUTTERWORTH_SMOOTHING` -> `Butterworth Smoothing`
- `AMR_WAIT_CLOSE` -> `Confirm Signals on Bar Close`
- `AMR_SHOW_INVALIDATION_LEVELS` -> `Show Invalidation Levels`
- `AMR_SHOW_KELTNER_CHANNEL` -> `Show Keltner Channel`
- `AMR_KC_LENGTH` -> `KC Length`
- `AMR_KC_MA_TYPE` -> `KC MA Type`
- `AMR_ATR_LENGTH` -> `ATR Length`
- `AMR_ATR_MULTIPLIER` -> `ATR Multiplier`

Execution/display:

- `AMR_LOOKBACK_BARS`
- `AMR_EXIT_ON_INVALIDATION`
- `AMR_LINE_PLOTS` (какие Pine-плоты вывести в figure-lines)

Side-конфиги:

- `LONG.enable`, `LONG.direction`, `LONG.TP`, `LONG.SL`
- `SHORT.enable`, `SHORT.direction`, `SHORT.TP`, `SHORT.SL`

Общие runtime-поля:

- `ENV`, `INTERVAL`, `MAKE_ORDERS`, `BACKTEST_PRICE_MODE`
- `AI_ENABLED`, `MIN_AI_QUALITY`
- `ML_ENABLED`, `ML_THRESHOLD`

## Payload сигнала

`figures`:

- линии по `AMR_LINE_PLOTS` (например KC + invalidation)
- точка входа

`additionalIndicators.amr`:

- `entryLong`, `entryShort`, `activeBuy`, `activeSell`, `invalidated`
- `signalOsc`
- значения KC и invalidation уровня
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
