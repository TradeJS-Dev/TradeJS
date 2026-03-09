---
title: 'MaStrategy'
---

`MaStrategy` is a TypeScript strategy (`@tradejs/core`) based on fast/slow moving average crossover.

## Entry Logic

1. Reads indicator snapshot (`maFast[]`, `maSlow[]`).
2. Detects crossover on last two values:

- bullish: fast crosses above slow
- bearish: fast crosses below slow

3. Selects side config (`LONG` or `SHORT`).
4. Computes TP/SL/qty.
5. Checks `minRiskRatio`, cooldown, and `MAX_CORRELATION`.
6. Returns `entry`.

## Exits

If a position exists, opposite MA cross closes it with `CLOSE_BY_OPPOSITE_MA_CROSS`.
Otherwise strategy returns `POSITION_HELD`.

## Config Parameters (What Each One Means)

### Shared Runtime Parameters

- `ENV` — runtime mode.
- `INTERVAL` — strategy timeframe.
- `MAKE_ORDERS` — whether to execute orders.
- `BACKTEST_PRICE_MODE` — backtest execution price mode.

### AI/ML Parameters

- `AI_ENABLED` — enables AI enrichment/gating.
- `MIN_AI_QUALITY` — minimum AI quality for execution.
- `ML_ENABLED` — enables ML enrichment.
- `ML_THRESHOLD` — ML threshold in runtime policy.

### Trading and Risk Parameters

- `CLOSE_OPPOSITE_POSITIONS` — close opposite position before opening a new one (hook-level).
- `FEE_PERCENT` — fee in risk/reward calculations.
- `MAX_LOSS_VALUE` — max loss value for quantity sizing.
- `MAX_CORRELATION` — maximum allowed BTC correlation.
- `TRADE_COOLDOWN_MS` — cooldown between trades in milliseconds.

### Indicator Parameters

- `MA_FAST` — fast MA period.
- `MA_SLOW` — slow MA period.

### `LONG` Scenario Parameters

- `LONG.enable` — enable/disable long scenario.
- `LONG.direction` — order direction (`LONG`).
- `LONG.TP` — take-profit in percent.
- `LONG.SL` — stop-loss in percent.
- `LONG.minRiskRatio` — minimum allowed risk/reward.

### `SHORT` Scenario Parameters

- `SHORT.enable` — enable/disable short scenario.
- `SHORT.direction` — order direction (`SHORT`).
- `SHORT.TP` — take-profit in percent.
- `SHORT.SL` — stop-loss in percent.
- `SHORT.minRiskRatio` — minimum allowed risk/reward.

## Indicators Used (What Each One Means)

- `maFast` — fast MA, used for cross detection.
- `maSlow` — slow MA, used for cross detection.
- `correlation` — BTC correlation, used as risk guard.

## Signal Payload

`figures`:

- `ma-fast` line
- `ma-slow` line
- `ma-cross` point

`additionalIndicators`:

- `crossKind`
- `maFastPrev`, `maFastCurrent`
- `maSlowPrev`, `maSlowCurrent`
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
npx @tradejs/cli backtest --user root --config MaStrategy:base --connector bybit --timeframe 15
npx @tradejs/cli signals --user root --timeframe 15
```
