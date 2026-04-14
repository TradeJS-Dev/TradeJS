# VolumeDivergence AI Replay Notes

Last updated: 2026-04-14.

This file keeps internal notes for `ai-train` replay windows and `VolumeDivergence` deterministic AI-gate analysis.

## Strategy intent

`VolumeDivergence` is a reversal strategy.

It looks for:

- `LONG` after bullish divergence:
  - price makes `lower low`
  - normalized volume makes `higher low`
- `SHORT` after bearish divergence:
  - price makes `higher high`
  - normalized volume makes `lower high`

The important distinction versus breakout strategies:

- the raw divergence itself is not enough
- the real question is whether price has actually started a reversal away from the pivot
- timing matters more than the fact of divergence

## Current export and config

Current merged export used for this replay:

```bash
data/ai/export/ai-dataset-volumedivergence-merged-1776185827684.jsonl
```

Current Redis config `VolumeDivergence:ai`:

```json
{
  "MAX_BARS_BETWEEN_PIVOTS": [24],
  "MIN_BARS_BETWEEN_PIVOTS": [6],
  "PIVOT_LOOKBACK_LEFT": [10],
  "NORMALIZATION_LENGTH": [120],
  "BULLISH": [
    {
      "enable": true,
      "direction": "LONG",
      "TP": 4.2,
      "SL": 1.2,
      "minRiskRatio": 2
    }
  ],
  "BEARISH": [
    {
      "enable": true,
      "direction": "SHORT",
      "TP": 3.8,
      "SL": 1.2,
      "minRiskRatio": 2
    }
  ]
}
```

Important:

- this is no longer a pure TP/SL config
- current detector point is:
  - `MAX_BARS_BETWEEN_PIVOTS` down to `24`
  - `MIN_BARS_BETWEEN_PIVOTS` up to `6`
  - `PIVOT_LOOKBACK_LEFT` up to `10`
  - `NORMALIZATION_LENGTH` up to `120`
- relative to the previous failed window, only `NORMALIZATION_LENGTH` changed

## Deterministic replay setup

Replay mode used:

```bash
yarn ai-train --strategy VolumeDivergence -n 500 --localOnly
```

This replay does not call OpenRouter.

It uses the deterministic strategy AI payload and local adapter gate only.

## Critical adapter fix found during investigation

Earlier in this investigation a real bug was found:

- `core.ts` writes `additionalIndicators.deltaAtPivot`
- `adapters/ai.ts` was reading `currentPivotDelta`

Because of this mismatch:

- `deltaAligned` was always `null`
- one scoring feature was dead

That fix remains important context:

- replay had improved from `accuracy 71.8%` to `73.4%`
- `precision_approved` improved from `16.7%` to `20.0%`
- `expectancy_delta` improved from `-1.25` to `+0.22`

So the current regression is not coming from that old field mismatch.

## Replay result: `latest 500`

Local deterministic replay on the current export and config:

- `accuracy = 81.8%`
- `TP/FP/TN/FN = 8 / 14 / 401 / 77`
- `approved = 22`
- `precision_approved = 36.4%`
- `recall_winners = 9.4%`
- `avg_profit_all = -1.86`
- `avg_profit_approved = +7.17`
- `expectancy_delta = +9.03`

Direction split:

- `LONG`: `8 / 12 / 209 / 60`, `approved = 20`
- `SHORT`: `0 / 2 / 192 / 17`, `approved = 2`

Deterministic flow:

- `selected = 500`
- `core_blocked_now = 9`
- `adapter_blocked_now = 469`
- `left_to_model_now = 22`

Quality breakdown:

- `quality=2`: `146` rows, `0` approvals, `8.2%` winrate, `avg_profit = -5.45`
- `quality=3`: `332` rows, `0` approvals, `19.6%` winrate, `avg_profit = -0.88`
- `quality=4`: `22` rows, `22` approvals, `36.4%` winrate, `avg_profit = +7.17`

Immediate interpretation:

- raw classification accuracy is not the headline metric here
- the approval stream widened again, but not into obviously broken territory
- approved expectancy improved again despite the wider flow
- the strategy is still trading selectivity for recall, but less aggressively than the previous snapshot
- `LONG` remains the only practically useful lane

## Comparison vs previous snapshot

Compared to the previous `latest 500` snapshot in this file:

- `accuracy`: `82.8% -> 81.8%`
- `TP`: `6 -> 8`
- `FP`: `10 -> 14`
- `TN`: `408 -> 401`
- `FN`: `76 -> 77`
- `approved`: `16 -> 22`
- `precision_approved`: `37.5% -> 36.4%`
- `recall_winners`: `7.3% -> 9.4%`
- `avg_profit_all`: `-2.23 -> -1.86`
- `avg_profit_approved`: `+5.19 -> +7.17`
- `expectancy_delta`: `+7.42 -> +9.03`

Interpretation:

- the current branch became a bit wider again
- approvals and false approvals both rose
- but approved expectancy improved even further
- this means the latest widening was not obviously bad on the freshest window
- the key question is no longer `latest 500`; it is now walk-forward stability

## Main discovery: `LONG q4 confirmation_ready` remains the whole game, and the latest validated window has no approved `double-conflict` pocket

The current replay is still dominated by one pocket:

- `LONG | q4 | confirmation_ready = 20` approvals
- winrate `40.0%`
- `avg_profit = +8.80`

Deeper split of approved rows:

- `LONG | q4 | confirmation_ready | coinAlign | btcAgainst = 10`
  - winrate `40.0%`
  - `avg_profit = +7.80`
- `LONG | q4 | confirmation_ready | coinAlign | btcAlign = 7`
  - winrate `28.6%`
  - `avg_profit = +5.81`
- `LONG | q4 | confirmation_ready | coinAgainst | btcAlign = 3`
  - winrate `66.7%`
  - `avg_profit = +19.09`
- `SHORT | q4 | confirmation_ready | coinAlign | btcAlign = 2`
  - winrate `0.0%`
  - `avg_profit = -9.13`

This means:

- the dominant `LONG q4` lane is still the only real approval lane
- on the latest validated window the approved `coinAgainst | btcAgainst` pocket disappeared
- the aligned or semi-aligned `LONG` pockets are carrying almost all useful approvals
- `SHORT q4` is currently too small and too weak to optimize around

## Direction asymmetry is now explicit

Current behavior:

- `SHORT` is still almost absent and currently not useful
- `LONG` carries almost all approvals
- the approval stream is now basically a `LONG confirmation_ready` research lane

Evidence:

- `SHORT approved = 2`, `TP = 0`, `FP = 2`
- `LONG approved = 20`, `TP = 8`, `FP = 12`

Practical interpretation:

- the strategy is still not symmetric
- `SHORT` remains a tiny research branch
- `LONG` is still the only lane with practical promise
- if the next step is lane cleanup, it should still focus on `LONG`

## FN reading

False negatives are still score-ladder cases.

Most profitable rejected rows are:

- `LONG | q3 | confirmation_ready | coinAgainst | btcAgainst = 29`, `avg_profit = +30.71`
- `LONG | q3 | confirmation_ready | coinAgainst | btcAlign = 16`, `avg_profit = +30.71`
- `LONG | q3 | confirmation_ready | coinAlign | btcAlign = 9`, `avg_profit = +30.71`
- `LONG | q3 | confirmation_ready | coinAlign | btcAgainst = 3`, `avg_profit = +30.71`
- `SHORT | q3 | confirmation_ready | coinAgainst | btcAgainst = 5`, `avg_profit = +27.39`

Meaning:

- the system is still losing winners because a big part of the profitable confirmed `LONG q3` bucket still does not get promoted
- but this bucket must now be read together with walk-forward, not just `latest 500`

This is now the main tradeoff:

- approved stream is positive
- but recall is still low
- so the next move still cannot be a broad `q3 -> q4` expansion

## Walk-forward check

The latest `500` rows look good, but the branch is not stable enough yet across older windows.

Current mini walk-forward:

- `latest 500`
  - `approved = 22`
  - `avg_profit_approved = +7.17`
  - `expectancy_delta = +9.03`
- `skip 500`
  - `approved = 16`
  - `avg_profit_approved = +2.39`
  - `expectancy_delta = +2.95`
- `skip 1000`
  - `approved = 14`
  - `avg_profit_approved = -2.02`
  - `expectancy_delta = +0.91`
- `latest 2000`
  - `approved = 70`
  - `avg_profit_approved = +2.18`
  - `expectancy_delta = +3.30`

Interpretation:

- the branch is not dead; aggregate `latest 2000` is still positive
- but the strength is concentrated in the freshest windows
- `skip 1000` is weak enough that overfitting risk is real
- from now on `latest 500` alone is not sufficient evidence

## Best and worst pockets

Best visible approved pockets:

- `LONG | q4 | confirmation_ready | coinAgainst | btcAlign = 3`
  - winrate `66.7%`
  - `avg_profit = +19.09`
- `LONG | q4 | confirmation_ready | coinAlign | btcAgainst = 10`
  - winrate `40.0%`
  - `avg_profit = +7.80`

These are not huge samples, but they show the lane can be positive without relying on `double-conflict` approvals.

Worst dominant pocket:

- the current worst validated live pocket is `SHORT | q4 | confirmation_ready | coinAlign | btcAlign = 2`
- the bigger concern is no longer one obvious live pocket on `latest 500`
- the bigger concern is the weak walk-forward result on `skip 1000`

Secondary bad pocket:

- `SHORT | q4 | confirmation_ready | coinAlign | btcAlign = 2`
- winrate `0.0%`
- `avg_profit = -9.13`

So the next cleanup target is still obvious:

- keep refining the `LONG q4` gate so it holds up outside the freshest window

## What to improve next

### 1. Strategy core

Do not reopen `structure_advance`.

Current evidence still says the next core change should be feature quality, not timing looseness.

The most promising new core feature candidate is:

- explicit maturity / freshness after detection

But the latest snapshot weakens the earlier “older is better” reading.

So if the core changes again, it should probably be in the direction of:

- exposing more explicit post-detection maturity features
- exposing regime features without assuming that age alone is positive
- not in the direction of reopening earlier entries

### 2. Backtest config

Do not explode the grid again.

The current detector point already proved that looser approval flow can reopen a bad lane.

Next config work should be compact and directional:

1. keep `LONG` only for the next research loop if the goal is pure lane cleanup
2. keep `MAX_BARS_BETWEEN_PIVOTS = 24`
3. keep `MIN_BARS_BETWEEN_PIVOTS = 6`
4. keep `PIVOT_LOOKBACK_LEFT = 10`
5. keep `NORMALIZATION_LENGTH = 120` for now

This is the first detector point in this branch that produced a positive approved stream.

Do not move away from it immediately.

Follow-up after the config comparison:

- the likely loosening culprit in the bad `80` window really was `NORMALIZATION_LENGTH: 100 -> 80`
- moving to `120` improved selectivity much more than it hurt the approved stream
- so the next compact config candidate should not be a big grid
- first rerun the same point with the latest adapter changes

Only after that, if you want one next config probe:

```json
{
  "MAX_BARS_BETWEEN_PIVOTS": [24],
  "MIN_BARS_BETWEEN_PIVOTS": [6],
  "PIVOT_LOOKBACK_LEFT": [10],
  "NORMALIZATION_LENGTH": [140]
}
```

If one more follow-up point is needed after that:

```json
{
  "MAX_BARS_BETWEEN_PIVOTS": [24],
  "MIN_BARS_BETWEEN_PIVOTS": [6],
  "PIVOT_LOOKBACK_LEFT": [12],
  "NORMALIZATION_LENGTH": [120]
}
```

### 3. AI adapter

The adapter has already been tightened again after the replay above, but those latest code changes are not validated on a fresh export yet.

Most recent adapter direction:

- keep `semi-aligned` selective promotion
- tighten `aligned` promotion
- remove the soft counter-trend fallback from the base `q4` branch
- keep the stronger demotion for oversized `double-conflict` `LONG`

This is the correct next experiment because:

- `latest 500` widened in a healthy way
- `skip 1000` suggested the main problem was not `semi-aligned` promotion
- the weak point was broader `q4` stability across older windows

## Code changes applied on 2026-04-14

Validated replay effects on the current branch:

Observed effect:

- `approved: 16 -> 22`
- `FP: 10 -> 14`
- `avg_profit_approved: +5.19 -> +7.17`
- `expectancy_delta: +7.42 -> +9.03`

Interpretation:

- the latest validated widening improved the freshest window
- but walk-forward stayed weak enough that more tightening is still justified

Not yet validated on fresh export:

- tighter `aligned` promotion
- removed soft counter-trend fallback from the base `q4` branch

## Practical current verdict

Current `VolumeDivergence` is still not ready for production.

The important result of the latest validated replay set:

- approved expectancy is positive on `latest 500` and on `latest 2000`
- `LONG` remains the only plausible research lane
- the main remaining problem is now walk-forward stability, not just `latest 500`
- the next risk is no longer only under-trading; it is also fresh-window overfitting

So the next move should be:

1. keep the same detector point: `NORMALIZATION_LENGTH = 120`
2. validate the newest adapter changes on a fresh export
3. keep judging the strategy on `latest 500`, `skip 500`, and `skip 1000` together
4. avoid reopening broader `q3 -> q4` promotion paths until walk-forward improves
5. keep `SHORT` out of focus for now
