---
name: doubletap-strategy-research
description: Build, tune, backtest, and research the TradeJS DoubleTap strategy, including StrategyAPI implementation, figures, Redis backtest configs, AI adapter checks, and later ai-train local gate investigations.
---

# DoubleTap Strategy Research

Use this skill when working on the built-in `DoubleTap` strategy in `packages/strategies/src/DoubleTap`.

## Strategy Shape

- `core.ts` must use `StrategyAPI`; do not call AI/ML providers or order placement directly.
- `engine.ts` ports the Bjorgum Double Tap pattern mechanics:
  - maintain swing pivots from rolling highest/lowest windows
  - detect double bottom on close above neckline
  - detect double top on close below neckline
  - derive target from `DOUBLETAP_TARGET_FIB_PCT`
  - derive stop from invalidation pivot and `DOUBLETAP_STOP_FIB_PCT`
- `figures.ts` is required. Include pattern zig-zag, neckline, target, stop, pivot points, and entry marker.
- `adapters/ai.ts` should carry `doubleTapContext` into the AI payload and keep local gate logic deterministic.

## Backtest Workflow

1. Prepare or update Redis backtest config under `users:root:backtests:configs:DoubleTap:<name>`.
2. Start with small cache-only runs: `yarn backtest -c DoubleTap:<name> -d 30 --cacheOnly --fast`.
3. Tune only DoubleTap-specific grid fields first:
   - `DOUBLETAP_PIVOT_LENGTH`
   - `DOUBLETAP_PIVOT_TOLERANCE_PCT`
   - `DOUBLETAP_TARGET_FIB_PCT`
   - `DOUBLETAP_STOP_FIB_PCT`
   - `DOUBLETAP_MIN_PATTERN_HEIGHT_PCT`
   - `DOUBLETAP_MAX_BREAKOUT_DISTANCE_PCT`
   - side `minRiskRatio`
4. Once a config is stable across 20+ tickers on `-d 30`, use it for year-scale `--ai` exports before starting local ai-train gate work.

## Validation

- Run `yarn jest packages/strategies/src/DoubleTap --runInBand` after strategy edits.
- Run `yarn prettify` before broader verification.
- Run `yarn checks` before final handoff when practical.
