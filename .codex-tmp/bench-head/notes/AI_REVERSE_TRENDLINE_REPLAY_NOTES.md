# ReverseTrendLine AI Replay Notes

Last updated: 2026-04-10.

This file keeps internal notes for `ai-train` replay windows and `ReverseTrendLine` AI gate analysis.

## Strategy intent

`ReverseTrendLine` is not a breakout strategy.

It looks for:

- `LONG` bounce from support line (`trendline.mode="lows"`)
- `SHORT` bounce from resistance line (`trendline.mode="highs"`)

The important distinction versus `TrendLine`:

- breakout bias alignment is not always a positive signal here
- some good bounce setups are actually mean-reversion reactions against current MA bias

## Baseline export

Current working export:

```bash
data/ai/export/ai-dataset-reversetrendline-merged-1775747533726.jsonl
```

Quick context:

- `584` rows total
- `ReverseTrendLine` approve/reject is currently deterministic in adapter post-process
- local replay without OpenRouter is equivalent for current gate analysis because:
  - `approvalAllowedNow`
  - `deterministicQuality`
  - final `direction`
  are decided in code, not by the model

## Initial replay: `latest 200`

Local deterministic replay-equivalent before quality-ladder fixes:

- `accuracy = 70.0%`
- `TP/FP/TN/FN = 4 / 17 / 136 / 43`
- `approved = 21`
- `precision_approved = 19.0%`
- `recall_winners = 8.5%`
- `avg_profit_all = -1.69`
- `avg_profit_approved = -2.35`
- `expectancy_delta = -0.66`

Initial finding:

- the original `ReverseTrendLine` approvals were bad
- all approvals were `ready_rejection`
- current deterministic ladder approved too many same-bar rejection candles that did not carry a real edge

## First key discovery

On `latest 200`, the important split was not `MACD`, and not generic rejection strength alone.

The strongest split was:

- `aligned ready_rejection` was weak
- `conflict-only ready_rejection` was much better

Meaning:

- if both coin and BTC bias looked aligned with the bounce, same-bar rejection was often a bad signal
- if exactly one side was in conflict, the setup often behaved more like a real mean-reversion bounce

This is opposite to the standard breakout intuition and is the main reason `ReverseTrendLine` must not reuse `TrendLine` bias logic.

## Deterministic ladder refinement

Implemented in commit:

- `dc3be16` `Refine ReverseTrendLine deterministic AI ladder`

Core change:

- `aligned ready_rejection` is no longer approved by default
- approval is limited to:
  - strong `conflict-only ready_rejection`
  - confirmed `aligned ready_follow_through`

Replay result on `latest 200` after this change:

- `accuracy = 80.5%`
- `TP/FP/TN/FN = 10 / 2 / 151 / 37`
- `approved = 12`
- `precision_approved = 83.3%`
- `recall_winners = 21.3%`
- `avg_profit_all = -1.69`
- `avg_profit_approved = 13.16`
- `expectancy_delta = +14.85`

Direction split:

- `LONG`: `5 / 0 / 74 / 24`
- `SHORT`: `5 / 2 / 77 / 13`

Interpretation:

- this was a large improvement and clearly not cosmetic
- `ReverseTrendLine` moved from negative expectancy on approved trades to clearly positive
- `LONG` became especially clean after removing generic aligned same-bar rejection approvals

## Replay check: `latest 500`

After `dc3be16`, replay on `latest 500`:

- `accuracy = 74.2%`
- `TP/FP/TN/FN = 19 / 19 / 352 / 110`
- `approved = 38`
- `precision_approved = 50.0%`
- `recall_winners = 14.7%`
- `avg_profit_all = -1.33`
- `avg_profit_approved = 4.01`
- `expectancy_delta = +5.35`

Interpretation:

- the improvement from `latest 200` did not fully collapse on a larger window
- but `SHORT` was still too noisy
- main weak spot became `SHORT ready_rejection`

## Analysis of `SHORT` false positives on `latest 500`

At this stage:

- `SHORT TP = 11`
- `SHORT FP = 14`

All approved `SHORT` were still:

- `entryTiming = ready_rejection`

The strongest split was again not `MACD`, but conflict type:

- `SHORT TP`: `9 coin_only`, `2 btc_only`
- `SHORT FP`: `7 coin_only`, `7 btc_only`

This suggested:

- `coin_only` conflict is acceptable or even useful for mean-reversion short bounce
- `btc_only` conflict is materially worse

## MACD analysis

`MACD` was investigated as a possible extra filter for `SHORT`.

Result:

- it did not provide a strong clean separation between `SHORT TP` and `SHORT FP`
- many winner short-bounce setups still had positive / non-bearish `MACD`
- this is plausible for mean-reversion trades, where local reversal can start before momentum indicators fully roll over

Practical conclusion:

- do not add `MACD` as a hard gate for `ReverseTrendLine` right now
- if used later, it should only be a soft secondary score, not a deterministic block

## SHORT `btc_only` tightening

Implemented in commit:

- `d399874` `Tighten ReverseTrendLine short btc-only bounces`

Core change:

- `SHORT ready_rejection` with `btc_only` conflict is no longer approved by default
- `MACD` was intentionally not added

Replay result on `latest 500` after this change:

- `accuracy = 75.2%`
- `TP/FP/TN/FN = 17 / 12 / 359 / 112`
- `approved = 29`
- `precision_approved = 58.6%`
- `recall_winners = 13.2%`
- `avg_profit_all = -1.33`
- `avg_profit_approved = 5.95`
- `expectancy_delta = +7.28`

Direction split:

- `LONG`: `8 / 5 / 158 / 51`
- `SHORT`: `9 / 7 / 201 / 61`

Interpretation:

- `SHORT` quality improved
- precision improved from `50.0%` to `58.6%`
- approved-trade expectancy improved from `+5.35` delta to `+7.28`
- recall became slightly worse, but the tradeoff was still favorable

## Score-based rejection lane

Current change after the `SHORT btc_only` tightening:

- keep the existing deterministic ladder as the main gate
- add a very narrow score-based lane only for `ready_rejection`
- do not use score as a global replacement for the ladder

The lane is intentionally restricted to current weak pockets:

- `LONG` only for `conflictState = both`
- `SHORT` only for `conflictState = none`
- threshold is high enough to keep this as a small add-on, not a broad relaxation

Scoring shape:

- base points for:
  - `rejectionStrengthPct`
  - `rejectionWickPct`
  - `touches`
  - `distance <= 250`
- extra directional points:
  - `LONG`: extra weight for `both` conflict and very large wick
  - `SHORT`: extra weight for clean `none` conflict and very near-line reaction

Replay result on `latest 500` after this score lane:

- `accuracy = 75.8%`
- `TP/FP/TN/FN = 21 / 13 / 358 / 108`
- `approved = 34`
- `precision_approved = 61.8%`
- `recall_winners = 16.3%`
- `avg_profit_all = -1.33`
- `avg_profit_approved = 6.58`
- `expectancy_delta = +7.91`

Direction split:

- `LONG`: `11 / 6 / 157 / 48`
- `SHORT`: `10 / 7 / 201 / 60`

Interpretation:

- this is better than the previous `75.2% / 17 / 12 / 359 / 112` state
- approved count rose only from `29` to `34`
- precision improved from `58.6%` to `61.8%`
- approved-trade expectancy also improved
- recall is still low, but we reduced `FN` without reopening the whole rejection bucket

What the score lane actually added on `latest 500`:

- `5` extra approvals
- `4` extra winners
- `1` extra loser

Meaning:

- this was a useful narrow fix
- the score lane is working as a pocket recovery mechanism, not as a broad quality relaxation

## Current state

Best current practical reading:

- `ReverseTrendLine` is no longer obviously broken
- the strategy now shows a positive edge on approved trades
- the narrow score lane improved both precision and recall on `latest 500`
- but it is still early and less mature than `TrendLine`

Current bottlenecks:

- `LONG` still misses many winners even after the score lane
- `SHORT ready_rejection` still has noise outside the clean `none` pocket
- approved set is small and recall remains low

## Current working hypotheses

What seems true now:

- `ReverseTrendLine` should not treat bias conflict the same way breakout logic does
- `aligned same-bar rejection` is weak
- `conflict-only rejection` can be a valid mean-reversion clue
- `btc_only` is materially weaker than `coin_only` for `SHORT`
- some `none/both` rejection setups can be recovered, but only with a very narrow score lane

What does not currently look promising:

- adding `MACD` as a hard filter
- blindly relaxing all `ready_rejection` setups
- importing `TrendLine` bias rules into `ReverseTrendLine`

## Next steps

Recommended order:

1. Analyze the remaining `FN` on `latest 500` after the score lane, not the old pre-score snapshot.
2. Check whether another narrow recovery pocket exists for `LONG` outside the current `both + large wick` bucket.
3. Check whether `SHORT none` can be split further by freshness / follow-through instead of only rejection-bar shape.
4. Look for retest / follow-through confirmation features specific to bounce setups.
5. Keep `MACD` out of deterministic gating unless a future replay shows a much cleaner split.
6. Re-run validation on fresh export windows after every deterministic ladder change.

## Relevant commits

- `148ac4e` `Add ReverseTrendLine bounce strategy`
- `dc3be16` `Refine ReverseTrendLine deterministic AI ladder`
- `d399874` `Tighten ReverseTrendLine short btc-only bounces`
