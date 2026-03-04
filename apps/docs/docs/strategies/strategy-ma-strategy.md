---
title: 'Strategy Reference: MaStrategy'
---

`MaStrategy` is a TypeScript strategy (`packages/core/src/strategy/MaStrategy`) based on fast/slow MA crossover.

## How Entry Works

1. Read indicator history snapshot (`maFast[]`, `maSlow[]`).
2. Detect crossover on last two points:

- bullish cross: fast crosses above slow
- bearish cross: fast crosses below slow

3. If side config (`LONG` or `SHORT`) is enabled, compute TP/SL/qty.
4. Enforce `minRiskRatio`, optional cooldown (`TRADE_COOLDOWN_MS`), and non-backtest `MAX_CORRELATION`.
5. Return `entry` with MA lines and cross point in figures.

## Exits

If position exists, opposite MA cross closes it with `CLOSE_BY_OPPOSITE_MA_CROSS`.
Otherwise signal is skipped with `POSITION_HELD`.

## Config Parameters

Side configs:

- `LONG.enable`, `LONG.direction`, `LONG.TP`, `LONG.SL`, `LONG.minRiskRatio`
- `SHORT.enable`, `SHORT.direction`, `SHORT.TP`, `SHORT.SL`, `SHORT.minRiskRatio`

Risk/runtime:

- `FEE_PERCENT`, `MAX_LOSS_VALUE`, `MAX_CORRELATION`
- `TRADE_COOLDOWN_MS`

Shared runtime:

- `ENV`, `INTERVAL`, `MAKE_ORDERS`, `BACKTEST_PRICE_MODE`
- `AI_ENABLED`, `MIN_AI_QUALITY`
- `ML_ENABLED`, `ML_THRESHOLD`

Indicator periods used directly:

- `MA_FAST`, `MA_SLOW`

## Signal Payload

`figures`:

- `ma-fast` line
- `ma-slow` line
- `ma-cross` point

`additionalIndicators`:

- `crossKind`
- `maFastPrev`, `maFastCurrent`, `maSlowPrev`, `maSlowCurrent`
- `maGap`
- `correlation`

## Example Runtime Config

```json
{
  "ENV": "CRON",
  "INTERVAL": "15",
  "MA_FAST": 21,
  "MA_SLOW": 55,
  "TRADE_COOLDOWN_MS": 0,
  "LONG": {
    "enable": true,
    "direction": "LONG",
    "TP": 2,
    "SL": 1,
    "minRiskRatio": 1.5
  },
  "SHORT": {
    "enable": true,
    "direction": "SHORT",
    "TP": 2,
    "SL": 1,
    "minRiskRatio": 1.5
  }
}
```

## Run

```bash
yarn backtest --user root --config MaStrategy:base --connector bybit --timeframe 15
yarn signals --user root --timeframe 15
```
