---
title: 'TrendLine'
---

`TrendLine` is a built-in TypeScript strategy from `@tradejs/strategies` that opens trades on trendline breakouts with risk guards.

## Entry Logic

1. Builds trendlines from highs/lows via `createTrendlineEngine`.
2. Selects the best line (`lows` first, otherwise `highs`).
3. Runs guards: no line, open position exists, cooldown, excessive volatility.
4. Selects side config:

- `HIGHS` for resistance breakout
- `LOWS` for support breakout

5. Computes TP/SL/qty via `strategyApi.getDirectionalTpSlPrices`.
6. Validates `minRiskRatio` and `MAX_CORRELATION`.
7. Returns `entry` with figures and trendline metadata.

## Exits

`core.ts` does not implement active position management.
Position lifecycle is handled by TP/SL and shared runtime/order execution.

## Config Parameters (What Each One Means)

### Shared Runtime Parameters

- `ENV` — runtime mode (`BACKTEST`, `CRON`, `LIVE`, etc.).
- `INTERVAL` — strategy timeframe.
- `MAKE_ORDERS` — if `false`, orders are not executed.
- `BACKTEST_PRICE_MODE` — backtest execution price mode (`open`/`close`/`mid`).

### AI/ML Parameters

- `AI_ENABLED` — enables AI enrichment and AI gating.
- `MIN_AI_QUALITY` — minimum AI quality for order execution outside `BACKTEST`.
- `ML_ENABLED` — enables ML enrichment.
- `ML_THRESHOLD` — ML threshold used by runtime policy.

### Trading and Risk Parameters

- `CLOSE_OPPOSITE_POSITIONS` — close opposite position before new entry (hook-level).
- `FEE_PERCENT` — fee used in risk/reward calculations.
- `MAX_LOSS_VALUE` — max allowed loss value to size `qty`.
- `MAX_CORRELATION` — max allowed correlation with BTC.

### Trendline Detection Parameters

- `TRENDLINE.minTouches` — minimum touches required for a valid line.
- `TRENDLINE.offset` — offset used for pivot capture.
- `TRENDLINE.epsilon` — base tolerance from trendline.
- `TRENDLINE.epsilonOffset` — extra tolerance for noisy markets.

### `HIGHS` Scenario Parameters

- `HIGHS.enable` — enable/disable scenario.
- `HIGHS.direction` — trade direction (`LONG`/`SHORT`).
- `HIGHS.TP` — take-profit in percent.
- `HIGHS.SL` — stop-loss in percent.
- `HIGHS.minRiskRatio` — minimum allowed risk/reward.

### `LOWS` Scenario Parameters

- `LOWS.enable` — enable/disable scenario.
- `LOWS.direction` — trade direction (`LONG`/`SHORT`).
- `LOWS.TP` — take-profit in percent.
- `LOWS.SL` — stop-loss in percent.
- `LOWS.minRiskRatio` — minimum allowed risk/reward.

## Indicators Used (What Each One Means)

- `correlation` — correlation between asset and BTC; used as the runtime risk guard (`MAX_CORRELATION`).
- `trendLine` (derived geometry, not a base indicator) — selected line from trendline engine; this drives entry direction/placement.

## Signal Payload

`figures`:

- `lines[]` — selected trendline
- `points[]` — trendline points/touches

`additionalIndicators`:

- `touches`
- `distance`
- `trendLine`

## Example Runtime Config

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

## Run

```bash
npx @tradejs/cli backtest --user root --config TrendLine:base --connector bybit --timeframe 15
npx @tradejs/cli signals --user root --timeframe 15
```
