---
title: 'Стратегия: VolumeDivergence (референс)'
---

`VolumeDivergence` — TypeScript-стратегия разворота (`packages/core/src/strategy/VolumeDivergence`), которая сравнивает price pivots и pivots нормализованного объема.

## Логика входа

1. Ведет series нормализованного объема (`0..100`) по окну `NORMALIZATION_LENGTH`.
2. Подтверждает pivot-high на нормализованном объеме (`PIVOT_LOOKBACK_LEFT`, `PIVOT_LOOKBACK_RIGHT`).
3. Сравнивает текущий и предыдущий pivot:

- bullish divergence: цена делает lower low, а normalized volume — higher low
- bearish divergence: цена делает higher high, а normalized volume — lower high

4. Проверяет расстояние между pivot-confirmations:

- `MIN_BARS_BETWEEN_PIVOTS`
- `MAX_BARS_BETWEEN_PIVOTS`

5. Применяет side-конфиг (`BULLISH` или `BEARISH`) и проверки TP/SL/risk.
6. Применяет correlation guard (вне `BACKTEST`).

## Выходы

`core.ts` открывает сделки только когда нет активной позиции; отдельного active-exit сопровождения не делает.
Закрытие идет через TP/SL или runtime-управление позицией.

## Параметры конфига

Модель дивергенции:

- `NORMALIZATION_LENGTH`
- `PIVOT_LOOKBACK_LEFT`
- `PIVOT_LOOKBACK_RIGHT`
- `MIN_BARS_BETWEEN_PIVOTS`
- `MAX_BARS_BETWEEN_PIVOTS`

Side/risk модель:

- `BULLISH.enable`, `BULLISH.direction`, `BULLISH.TP`, `BULLISH.SL`, `BULLISH.minRiskRatio`
- `BEARISH.enable`, `BEARISH.direction`, `BEARISH.TP`, `BEARISH.SL`, `BEARISH.minRiskRatio`
- `FEE_PERCENT`, `MAX_LOSS_VALUE`, `MAX_CORRELATION`
- `CLOSE_OPPOSITE_POSITIONS` (hook-уровень)

Общие runtime-поля:

- `ENV`, `INTERVAL`, `MAKE_ORDERS`, `BACKTEST_PRICE_MODE`
- `AI_ENABLED`, `MIN_AI_QUALITY`
- `ML_ENABLED`, `ML_THRESHOLD`

Периоды общих индикаторов (для payload/ML-контекста):

- `MA_FAST`, `MA_MEDIUM`, `MA_SLOW`
- `OBV_SMA`, `ATR`, `ATR_PCT_SHORT`, `ATR_PCT_LONG`
- `BB`, `BB_STD`, `MACD_FAST`, `MACD_SLOW`, `MACD_SIGNAL`
- `LEVEL_LOOKBACK`, `LEVEL_DELAY`

## Payload сигнала

`figures`:

- дивергенс-линия между двумя price pivots
- две pivot-точки

`additionalIndicators` содержит расширенный блок:

- `divergenceKind`
- normalized volume на pivot
- proxy delta на pivot (`deltaAtPivot`)
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
