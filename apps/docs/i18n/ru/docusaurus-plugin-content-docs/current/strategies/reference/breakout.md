---
title: 'Breakout'
---

`Breakout` — встроенная TypeScript-стратегия из `@tradejs/strategies` с весовой моделью сигналов для long/short breakout-сценариев.

## Логика входа

На каждой свече стратегия считает набор булевых сигналов и открывает позицию, если:

- выполнены обязательные сигналы (`required: true`)
- суммарный балл >= порога `REQUIRED_SCORE_*`

Long и short используют отдельные карты сигналов (`SIGNALS_LONG`, `SIGNALS_SHORT`).

## Выходы

При открытой позиции стратегия закрывает ее если:

- появился противоположный open-сигнал (`CLOSE_POSITION_BY_OPEN_SIGNAL`)
- MA-тренд развернулся против позиции (`CLOSE_POSITION_BY_SMA`)

Иначе возвращает `POSITION_HELD`.

## Параметры конфига (что означает каждый)

### Общие runtime-параметры

- `ENV` — режим запуска.
- `INTERVAL` — таймфрейм.
- `MAKE_ORDERS` — исполнять ордера или нет.
- `BACKTEST_PRICE_MODE` — режим цены исполнения в бэктесте.

### AI/ML-параметры

- `AI_ENABLED` — включает AI enrichment/gating.
- `MIN_AI_QUALITY` — минимальное AI-качество для исполнения.
- `ML_ENABLED` — включает ML enrichment.
- `ML_THRESHOLD` — порог ML-оценки.

### Параметры скоринга

- `SIGNALS_LONG` — карта long-сигналов (`weight`, `required`).
- `SIGNALS_SHORT` — карта short-сигналов (`weight`, `required`).
- `REQUIRED_SCORE_LONG` — минимальный score для открытия long.
- `REQUIRED_SCORE_SHORT` — минимальный score для открытия short.

### Параметры позиции/риска

- `LIMIT` — размер позиции в quote-валюте (qty = `LIMIT / currentPrice`).
- `TP_LONG[]` — лестница take-profit для long (`profit`, `rate`).
- `TP_SHORT[]` — лестница take-profit для short (`profit`, `rate`).
- `SL_LONG` — stop-loss для long (ratio).
- `SL_SHORT` — stop-loss для short (ratio).
- `ATR_OPEN` — множитель порога волатильности для сигнала `VOLATILE`.

### Параметры периодов индикаторов

- `MA_FAST` — период fast MA.
- `MA_SLOW` — период slow MA.
- `OBV_SMA` — период SMA для OBV.
- `ATR` — период ATR.
- `BB` — период Bollinger Bands.
- `BB_STD` — множитель Bollinger Bands.
- `LEVEL_LOOKBACK` — окно расчета локальных уровней.
- `LEVEL_DELAY` — задержка подтверждения уровней.

### Параметры, которые есть в конфиге, но не участвуют в текущей логике `core.ts`

- `ATR_PERIOD`
- `BB_PERIOD`
- `BB_STDDEV`
- `ATR_CLOSE`
- `OBV_SMA_PERIOD`
- `BREAKOUT_LOOKBACK_DELAY`
- `BREAKOUT_LOOKBACK`

## Используемые индикаторы (что означает каждый)

### В логике сигналов

- `maFast`, `maSlow` — проверка uptrend/downtrend.
- `obv`, `smaObv` — проверка OBV относительно своей SMA.
- `atr` — расчет условия `VOLATILE`.
- `bbUpper`, `bbLower` — проверки выхода цены за Bollinger Bands.
- `highLevel`, `lowLevel` — уровни пробоя/пролива.
- `prevCandle` — предыдущая свеча для сравнений high/low/close.

### В payload

- `correlation` — передается в `indicators` для анализа/ML.

## Payload сигнала

`additionalIndicators`:

- `highLevel`, `lowLevel`
- `signals` (карта всех булевых проверок)

`figures` сейчас пустой (`buildBreakoutFigures()` возвращает `{}`).

## Пример runtime-конфига

```json
{
  "ENV": "CRON",
  "INTERVAL": "15",
  "LIMIT": 100,
  "ATR_OPEN": 0.5,
  "REQUIRED_SCORE_LONG": 7,
  "REQUIRED_SCORE_SHORT": 7,
  "TP_LONG": [
    { "profit": 0.1, "rate": 0.25 },
    { "profit": 0.15, "rate": 0.5 }
  ],
  "TP_SHORT": [
    { "profit": 0.05, "rate": 0.25 },
    { "profit": 0.1, "rate": 0.5 }
  ],
  "SL_LONG": 0.06,
  "SL_SHORT": 0.03
}
```

## Запуск

```bash
npx @tradejs/cli backtest --user root --config Breakout:base --connector bybit --timeframe 15
npx @tradejs/cli signals --user root --timeframe 15
```
