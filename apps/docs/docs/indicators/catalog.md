---
title: Indicator Catalog (Current Core)
---

This page lists indicators currently produced/used by core runtime.

Primary implementation:

- `@tradejs/core`

## 1. Base Indicator Snapshot

Per-bar `IndicatorSnapshot` fields:

- `maFast`, `maMedium`, `maSlow` (SMA)
- `atr`
- `atrPct` (ratio of short ATR% SMA to long ATR% SMA)
- `bbUpper`, `bbMiddle`, `bbLower`
- `obv`, `smaObv`
- `macd`, `macdSignal`, `macdHistogram`
- `price1hPcnt`, `price24hPcnt`
- `highPrice1h`, `lowPrice1h`, `volume1h`
- `highPrice24h`, `lowPrice24h`, `volume24h`
- `highLevel`, `lowLevel`
- `prevClose`
- `correlation` (coin vs BTC over correlation window)
- `spread` (smoothed Binance/Coinbase BTC spread when available)

## 2. History Snapshot Keys

`IndicatorsHistorySnapshot` stores rolling arrays of the same fields above (`maFast[]`, `atr[]`, `bbUpper[]`, ...).

Strategies usually access:

- full snapshot (`indicatorsState.snapshot()`)
- latest scalar (`indicatorsState.latestNumber('<key>')`)

## 3. ML Candle Payload

When ML payload is enabled, snapshot also includes candle windows:

- `candles15m`, `candles1h`, `candles4h`, `candles1d`
- `btcCandles15m`, `btcCandles1h`, `btcCandles4h`, `btcCandles1d`

## 4. Multi-Timeframe Indicator Series

Core builds extra timeframe series for ML using suffixes:

- `*1h`
- `*4h`
- `*1d`

For BTC context, keys are prefixed with `btc` (`btcMaFast`, `btcMaFast1h`, etc).

## 5. Built-In Indicator Helpers

From `@tradejs/core`:

- `MOM`: momentum (`price - price[period]`)
- `smaAligned`: SMA with alignment to source length/warmup
- `ATR_PCT`: ATR%, short/long SMA lines, and short/long ratio
- `createSpreadSmoother`, `smoothSpreadSeries`: moving smoothed spread

## 6. Plugin Indicators

Indicator plugins are registered via registry:

- `registerIndicatorEntries`
- `getRegisteredIndicatorEntries`

Each plugin may provide:

- indicator metadata for UI/catalog
- compute function (adds custom series into indicator history)
- optional renderer for figures

## 7. Config Mapping

Default periods are controlled by strategy config keys (shared names):

- `MA_FAST`, `MA_MEDIUM`, `MA_SLOW`
- `OBV_SMA`
- `ATR`, `ATR_PCT_SHORT`, `ATR_PCT_LONG`
- `BB`, `BB_STD`
- `MACD_FAST`, `MACD_SLOW`, `MACD_SIGNAL`
- `LEVEL_LOOKBACK`, `LEVEL_DELAY`

If a strategy has these keys, runtime uses them to initialize indicator periods.
