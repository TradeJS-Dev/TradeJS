---
title: 'Стратегия: TrendLine'
---

`TrendLine` — TypeScript-стратегия (`packages/core/src/strategy/TrendLine`) для входа по пробою трендовой линии с риск-ограничениями.

## Логика входа

1. Строит трендлайны по high/low через `createTrendlineEngine`.
2. Берет лучшую линию (`lows` в приоритете, иначе `highs`).
3. Выполняет guard-проверки: нет линии, есть позиция, cooldown, слишком высокая волатильность свечей.
4. Выбирает side-конфиг:

- `HIGHS` — сценарий для пробоя сопротивления
- `LOWS` — сценарий для пробоя поддержки

5. Считает TP/SL/qty через `strategyApi.getDirectionalTpSlPrices`.
6. Проверяет `minRiskRatio` и `MAX_CORRELATION`.
7. Возвращает `entry` с figures и метаданными трендлайна.

## Выходы

В `core.ts` нет отдельного активного сопровождения позиции.
Позиция завершается через TP/SL и runtime/order engine.

## Параметры конфига (что означает каждый)

### Общие runtime-параметры

- `ENV` — режим запуска (`BACKTEST`, `CRON`, `LIVE` и т.д.).
- `INTERVAL` — рабочий таймфрейм стратегии.
- `MAKE_ORDERS` — если `false`, ордера не исполняются (сигналы продолжают считаться).
- `BACKTEST_PRICE_MODE` — как брать цену исполнения в бэктесте (`open`/`close`/`mid`).

### AI/ML-параметры

- `AI_ENABLED` — включает AI enrichment и AI-gating.
- `MIN_AI_QUALITY` — минимальное качество AI для исполнения ордера вне `BACKTEST`.
- `ML_ENABLED` — включает ML enrichment.
- `ML_THRESHOLD` — порог ML (используется runtime-слоем).

### Параметры торговли и риска

- `CLOSE_OPPOSITE_POSITIONS` — закрывать противоположную позицию перед новым входом (hook).
- `FEE_PERCENT` — комиссия, учитывается при расчете риск/прибыль.
- `MAX_LOSS_VALUE` — максимальный риск в валюте депозита для расчета `qty`.
- `MAX_CORRELATION` — верхний порог корреляции с BTC (guard вне `BACKTEST`).

### Параметры построения трендлайна

- `TRENDLINE.minTouches` — минимальное число касаний для валидной линии.
- `TRENDLINE.offset` — сдвиг для поиска опорных точек.
- `TRENDLINE.epsilon` — базовый допуск отклонения от линии.
- `TRENDLINE.epsilonOffset` — дополнительный допуск для устойчивости к шуму.

### Параметры сценария `HIGHS`

- `HIGHS.enable` — включить/выключить сценарий.
- `HIGHS.direction` — направление сделки (`LONG`/`SHORT`).
- `HIGHS.TP` — take-profit в процентах.
- `HIGHS.SL` — stop-loss в процентах.
- `HIGHS.minRiskRatio` — минимально допустимое отношение риск/прибыль.

### Параметры сценария `LOWS`

- `LOWS.enable` — включить/выключить сценарий.
- `LOWS.direction` — направление сделки (`LONG`/`SHORT`).
- `LOWS.TP` — take-profit в процентах.
- `LOWS.SL` — stop-loss в процентах.
- `LOWS.minRiskRatio` — минимально допустимое отношение риск/прибыль.

### Периоды индикаторов

- `MA_FAST` — период быстрой скользящей средней.
- `MA_MEDIUM` — период средней скользящей средней.
- `MA_SLOW` — период медленной скользящей средней.
- `OBV_SMA` — период SMA для OBV.
- `ATR` — период ATR.
- `ATR_PCT_SHORT` — короткое окно для ATR%.
- `ATR_PCT_LONG` — длинное окно для ATR%.
- `BB` — период Bollinger Bands.
- `BB_STD` — множитель стандартного отклонения Bollinger Bands.
- `MACD_FAST` — быстрый период MACD.
- `MACD_SLOW` — медленный период MACD.
- `MACD_SIGNAL` — период сигнальной линии MACD.
- `LEVEL_LOOKBACK` — окно расчета локальных уровней.
- `LEVEL_DELAY` — задержка подтверждения уровней.

## Используемые индикаторы (что означает каждый)

### В логике входа/фильтрах

- `correlation` — корреляция актива с BTC; используется как guard через `MAX_CORRELATION`.

### Передаются в payload (`indicators`) для анализа/ML

- `maFast`, `maMedium`, `maSlow` — быстрый/средний/медленный MA.
- `obv`, `smaObv` — OBV и его сглаживание.
- `atr`, `atrPctShort`, `atrPctLong` — абсолютная и относительная волатильность.
- `bbMiddle`, `bbUpper`, `bbLower` — границы Bollinger Bands.
- `macd`, `macdSignal`, `macdHistogram` — компоненты MACD.
- `highLevel`, `lowLevel` — локальные уровни high/low.
- `prevCandle` — предыдущая свеча для сравнений.
- `correlation` — корреляция с BTC.

## Payload сигнала

`figures`:

- `lines[]` — выбранная трендовая линия
- `points[]` — точки/касания трендлайна

`additionalIndicators`:

- `touches`
- `distance`
- `trendLine`

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

```bash
yarn backtest --user root --config TrendLine:base --connector bybit --timeframe 15
yarn signals --user root --timeframe 15
```
