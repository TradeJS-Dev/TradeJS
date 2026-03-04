---
title: 'Стратегия: TrendLine (референс)'
---

`TrendLine` — TypeScript-стратегия (`packages/core/src/strategy/TrendLine`) для входа по пробою трендовой линии с риск-ограничениями.

## Логика входа

1. Строит трендлайны по high/low через `createTrendlineEngine`.
2. Берет лучшую линию (`lows` в приоритете, иначе `highs`).
3. Делает guard-проверки: нет линии, есть позиция, cooldown, слишком волатильная свеча (`filterByVeryVolatility`).
4. Выбирает side-конфиг:

- `HIGHS` для пробоя сопротивления
- `LOWS` для пробоя поддержки

5. Считает TP/SL/qty через `strategyApi.getDirectionalTpSlPrices`.
6. Проверяет `minRiskRatio` и (вне бэктеста) `MAX_CORRELATION`.
7. Возвращает `entry` с figures и метаданными трендлайна.

## Выходы

В `core.ts` нет отдельного активного сопровождения позиции.
Жизненный цикл позиции идет через TP/SL и runtime/order engine; опциональное закрытие противоположной позиции делает hook из manifest.

## Параметры конфига

Основные торговые параметры:

- `HIGHS.enable`, `HIGHS.direction`, `HIGHS.TP`, `HIGHS.SL`, `HIGHS.minRiskRatio`
- `LOWS.enable`, `LOWS.direction`, `LOWS.TP`, `LOWS.SL`, `LOWS.minRiskRatio`
- `TRENDLINE.minTouches`, `TRENDLINE.offset`, `TRENDLINE.epsilon`, `TRENDLINE.epsilonOffset`
- `FEE_PERCENT`, `MAX_LOSS_VALUE`, `MAX_CORRELATION`
- `CLOSE_OPPOSITE_POSITIONS` (используется в `hooks.ts`)

Общие runtime-параметры:

- `ENV`, `INTERVAL`, `MAKE_ORDERS`, `BACKTEST_PRICE_MODE`
- `AI_ENABLED`, `MIN_AI_QUALITY`
- `ML_ENABLED`, `ML_THRESHOLD`

Периоды общих индикаторов, которые использует стратегия:

- `MA_FAST`, `MA_MEDIUM`, `MA_SLOW`
- `OBV_SMA`, `ATR`, `ATR_PCT_SHORT`, `ATR_PCT_LONG`
- `BB`, `BB_STD`, `MACD_FAST`, `MACD_SLOW`, `MACD_SIGNAL`
- `LEVEL_LOOKBACK`, `LEVEL_DELAY`

## Payload сигнала

`figures`:

- `lines[]`: выбранная трендовая линия
- `points[]`: точки/касания трендлайна

`additionalIndicators`:

- `touches`
- `distance`
- `trendLine` (полная геометрия)

## Пример runtime-конфига

```json
{
  "ENV": "CRON",
  "INTERVAL": "15",
  "MAKE_ORDERS": true,
  "CLOSE_OPPOSITE_POSITIONS": false,
  "TRENDLINE": {
    "minTouches": 4,
    "offset": 3,
    "epsilon": 0.003,
    "epsilonOffset": 0.004
  },
  "HIGHS": {
    "enable": true,
    "direction": "LONG",
    "TP": 4,
    "SL": 1.3,
    "minRiskRatio": 2
  },
  "LOWS": {
    "enable": true,
    "direction": "SHORT",
    "TP": 4,
    "SL": 1.3,
    "minRiskRatio": 2
  }
}
```

## Запуск

Бэктест:

```bash
yarn backtest --user root --config TrendLine:base --connector bybit --timeframe 15
```

Рантайм:

```bash
yarn signals --user root --timeframe 15
```
