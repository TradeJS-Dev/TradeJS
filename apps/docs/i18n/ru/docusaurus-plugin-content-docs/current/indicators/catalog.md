---
title: Каталог индикаторов (текущий core)
---

На этой странице перечислены индикаторы, которые сейчас строит и использует core runtime.

Основная реализация:

- `@tradejs/core`

## 1. Базовый Indicator Snapshot

Поля `IndicatorSnapshot` на каждую свечу:

- `maFast`, `maMedium`, `maSlow` (SMA)
- `atr`
- `atrPct` (отношение short ATR% SMA к long ATR% SMA)
- `bbUpper`, `bbMiddle`, `bbLower`
- `obv`, `smaObv`
- `macd`, `macdSignal`, `macdHistogram`
- `price1hPcnt`, `price24hPcnt`
- `highPrice1h`, `lowPrice1h`, `volume1h`
- `highPrice24h`, `lowPrice24h`, `volume24h`
- `highLevel`, `lowLevel`
- `prevClose`
- `correlation` (корреляция инструмента с BTC)
- `spread` (сглаженный Binance/Coinbase BTC spread, если доступен)

## 2. Исторические серии

`IndicatorsHistorySnapshot` хранит rolling-массивы по тем же ключам (`maFast[]`, `atr[]`, `bbUpper[]`, ...).

Стратегии обычно используют:

- полный snapshot (`indicatorsState.snapshot()`)
- последний scalar (`indicatorsState.latestNumber('<key>')`)

## 3. ML Candle Payload

Когда включен ML payload, snapshot также содержит окна свечей:

- `candles15m`, `candles1h`, `candles4h`, `candles1d`
- `btcCandles15m`, `btcCandles1h`, `btcCandles4h`, `btcCandles1d`

## 4. Multi-Timeframe серии индикаторов

Для ML core строит дополнительные серии с суффиксами:

- `*1h`
- `*4h`
- `*1d`

Для BTC-контекста ключи префиксуются `btc` (`btcMaFast`, `btcMaFast1h`, и т.д.).

## 5. Встроенные helper-индикаторы

Из `@tradejs/core`:

- `MOM`: momentum (`price - price[period]`)
- `smaAligned`: SMA с выравниванием длины/прогрева
- `ATR_PCT`: ATR%, short/long SMA линии и их отношение
- `createSpreadSmoother`, `smoothSpreadSeries`: сглаживание spread

## 6. Plugin индикаторы

Индикаторные плагины регистрируются через registry:

- `registerIndicatorEntries`
- `getRegisteredIndicatorEntries`

Плагин может дать:

- метаданные индикатора для каталога/UI
- compute-функцию (добавляет custom series)
- optional renderer для figures

## 7. Маппинг конфигов

Дефолтные периоды управляются ключами стратегии (общие имена):

- `MA_FAST`, `MA_MEDIUM`, `MA_SLOW`
- `OBV_SMA`
- `ATR`, `ATR_PCT_SHORT`, `ATR_PCT_LONG`
- `BB`, `BB_STD`
- `MACD_FAST`, `MACD_SLOW`, `MACD_SIGNAL`
- `LEVEL_LOOKBACK`, `LEVEL_DELAY`

Если стратегия задает эти ключи, runtime применяет их к индикаторному пайплайну.
