---
name: strategy-backtest-research
description: Build, tune, and backtest TradeJS strategies, including StrategyAPI implementation checks, strategy figures, Redis backtest configs, cache-only sweeps, and year-scale AI export preparation.
---

# Strategy Backtest Research

Use this skill when working on strategy implementation, figures, or backtest configuration in `packages/strategies/src/<StrategyName>`.

Do not use this skill for general `ai-train --localOnly` gate research. Use `ai-train-local-research` for local deterministic AI gate investigations across strategies.

## Strategy Shape

- `core.ts` must use `StrategyAPI`; do not call AI/ML providers or order placement directly.
- Geometry-based strategies should keep visual artifacts in the strategy package.
- `figures.ts` should include the lines/points needed to inspect why a trade happened.
- `adapters/ai.ts` should carry strategy-specific context into the AI payload when backtest exports need AI context, but local gate tuning belongs to `ai-train-local-research`.

## DoubleTap Notes

When the strategy is `DoubleTap`, `engine.ts` ports the Bjorgum Double Tap pattern mechanics:

  - maintain swing pivots from rolling highest/lowest windows
  - detect double bottom on close above neckline
  - detect double top on close below neckline
  - derive target from `DOUBLETAP_TARGET_FIB_PCT`
  - derive stop from invalidation pivot and `DOUBLETAP_STOP_FIB_PCT`
- `figures.ts` is required. Include pattern zig-zag, neckline, target, stop, pivot points, and entry marker.

## Backtest Workflow

1. Prepare or update Redis backtest config under `users:root:backtests:configs:<Strategy>:<name>`.
   - When a research config includes `MAX_LOSS_VALUE`, set it to `10`.
   - When updating a backtest `:ai` config, enable both `LONG` and `SHORT`; let the AI gate disable a side later if needed.
2. Start with small cache-only runs: `yarn backtest -c <Strategy>:<name> -d 30 --cacheOnly --fast`.
3. Tune strategy-specific grid fields first.

For DoubleTap, prioritize:

   - `DOUBLETAP_PIVOT_LENGTH`
   - `DOUBLETAP_PIVOT_TOLERANCE_PCT`
   - `DOUBLETAP_TARGET_FIB_PCT`
   - `DOUBLETAP_STOP_FIB_PCT`
   - `DOUBLETAP_MIN_PATTERN_HEIGHT_PCT`
   - `DOUBLETAP_MAX_BREAKOUT_DISTANCE_PCT`
   - side `minRiskRatio`

4. Once a config is stable across 20+ tickers on `-d 30`, use it for year-scale `--ai` exports. Analyze exported local AI gate behavior with `ai-train-local-research`.

For every AI export handed to gate research, record the merge id, shard count,
minimum and maximum timestamps, backtest config ids, git SHA, and the context env
used to construct derivatives/CMC inputs. A year-scale export without a fresh
terminal tail is suitable for historical research but not for a current live
cadence claim.

## Validation

- Run the affected strategy tests after strategy edits, for example `yarn jest packages/strategies/src/<StrategyName> --runInBand`.
- Run `yarn prettify` before broader verification.
- Run `yarn checks` before final handoff when practical.
