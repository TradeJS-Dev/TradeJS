---
title: 'Стратегия: VolumeDivergence'
---

`VolumeDivergence` — TypeScript-стратегия разворота (`packages/core/src/strategy/VolumeDivergence`), которая сравнивает price pivots и pivots нормализованного объема.

## Логика входа

1. Строит серию нормализованного объема (`0..100`) по окну `NORMALIZATION_LENGTH`.
2. Подтверждает pivot-high на нормализованном объеме (`PIVOT_LOOKBACK_LEFT`, `PIVOT_LOOKBACK_RIGHT`).
3. Сравнивает текущий и предыдущий pivot:

- bullish divergence: цена делает lower low, а normalized volume — higher low
- bearish divergence: цена делает higher high, а normalized volume — lower high

4. Проверяет расстояние между pivot-confirmation (`MIN_BARS_BETWEEN_PIVOTS`, `MAX_BARS_BETWEEN_PIVOTS`).
5. Применяет side-конфиг (`BULLISH` или `BEARISH`) и TP/SL/risk-проверки.
6. Применяет correlation guard.

## Выходы

Стратегия открывает сделку только когда нет активной позиции.
Отдельного active-exit сопровождения в `core.ts` нет; закрытие через TP/SL и runtime.

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

### Параметры торговли и риска

- `CLOSE_OPPOSITE_POSITIONS` — закрытие противоположной позиции перед новым входом (hook).
- `FEE_PERCENT` — комиссия в расчете риск/прибыль.
- `MAX_LOSS_VALUE` — максимальный риск для расчета `qty`.
- `MAX_CORRELATION` — максимум допустимой корреляции с BTC.

### Параметры модели дивергенции

- `NORMALIZATION_LENGTH` — окно нормализации объема.
- `PIVOT_LOOKBACK_LEFT` — сколько свечей слева нужно для подтверждения pivot.
- `PIVOT_LOOKBACK_RIGHT` — сколько свечей справа нужно для подтверждения pivot.
- `MIN_BARS_BETWEEN_PIVOTS` — минимальная дистанция между подтверждениями pivot.
- `MAX_BARS_BETWEEN_PIVOTS` — максимальная дистанция между подтверждениями pivot.

### Параметры сценария `BULLISH`

- `BULLISH.enable` — включить/выключить bullish-сценарий.
- `BULLISH.direction` — направление ордера.
- `BULLISH.TP` — take-profit в процентах.
- `BULLISH.SL` — stop-loss в процентах.
- `BULLISH.minRiskRatio` — минимально допустимое риск/прибыль.

### Параметры сценария `BEARISH`

- `BEARISH.enable` — включить/выключить bearish-сценарий.
- `BEARISH.direction` — направление ордера.
- `BEARISH.TP` — take-profit в процентах.
- `BEARISH.SL` — stop-loss в процентах.
- `BEARISH.minRiskRatio` — минимально допустимое риск/прибыль.

### Периоды индикаторов

- `MA_FAST`, `MA_MEDIUM`, `MA_SLOW` — периоды MA.
- `OBV_SMA` — период SMA для OBV.
- `ATR`, `ATR_PCT_SHORT`, `ATR_PCT_LONG` — волатильность ATR (абсолютная и относительная).
- `BB`, `BB_STD` — параметры Bollinger Bands.
- `MACD_FAST`, `MACD_SLOW`, `MACD_SIGNAL` — параметры MACD.
- `LEVEL_LOOKBACK`, `LEVEL_DELAY` — параметры расчета локальных уровней.

## Используемые индикаторы (что означает каждый)

### В логике стратегии

- `normalizedVolume` (внутренний расчет) — объем, нормализованный на локальный максимум.
- `volume pivot high` — pivot-точка на normalized volume.
- `price pivot high/low` — ценовые уровни в pivot-точках.
- `deltaAtPivot` — прокси дельты свечи в pivot (`volume * bodyBias`).
- `correlation` — корреляция актива с BTC для риск-guard.

### В payload (`indicators`) для AI/ML

- `maFast`, `maMedium`, `maSlow`
- `obv`, `smaObv`
- `atr`, `atrPctShort`, `atrPctLong`
- `bbMiddle`, `bbUpper`, `bbLower`
- `macd`, `macdSignal`, `macdHistogram`
- `highLevel`, `lowLevel`
- `correlation`

## Payload сигнала

`figures`:

- дивергенс-линия между двумя pivot
- pivot-точки

`additionalIndicators`:

- `divergenceKind`
- normalized volume на текущем/предыдущем pivot
- `deltaAtPivot`
- timestamps/indices/price уровни pivot

## Пример runtime-конфига

```json
{
  "ENV": "CRON",
  "INTERVAL": "15",
  "NORMALIZATION_LENGTH": 1000,
  "PIVOT_LOOKBACK_LEFT": 21,
  "PIVOT_LOOKBACK_RIGHT": 5,
  "MIN_BARS_BETWEEN_PIVOTS": 5,
  "MAX_BARS_BETWEEN_PIVOTS": 60,
  "BULLISH": {
    "enable": true,
    "direction": "LONG",
    "TP": 4,
    "SL": 1.3,
    "minRiskRatio": 2
  },
  "BEARISH": {
    "enable": true,
    "direction": "SHORT",
    "TP": 4,
    "SL": 1.3,
    "minRiskRatio": 2
  }
}
```

## Запуск

```bash
yarn backtest --user root --config VolumeDivergence:base --connector bybit --timeframe 15
yarn signals --user root --timeframe 15
```
