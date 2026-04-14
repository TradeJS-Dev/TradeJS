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
data/ai/export/ai-dataset-volumedivergence-merged-1776145408313.jsonl
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

- `accuracy = 66.0%`
- `TP/FP/TN/FN = 17 / 28 / 313 / 142`
- `approved = 45`
- `precision_approved = 37.8%`
- `recall_winners = 10.7%`
- `avg_profit_all = -0.20`
- `avg_profit_approved = +2.75`
- `expectancy_delta = +2.94`

Direction split:

- `LONG`: `16 / 27 / 152 / 92`, `approved = 43`
- `SHORT`: `1 / 1 / 161 / 50`, `approved = 2`

Deterministic flow:

- `selected = 500`
- `core_blocked_now = 8`
- `adapter_blocked_now = 447`
- `left_to_model_now = 45`

Quality breakdown:

- `quality=2`: `150` rows, `0` approvals, `26.7%` winrate, `avg_profit = -2.84`
- `quality=3`: `305` rows, `0` approvals, `33.4%` winrate, `avg_profit = +0.67`
- `quality=4`: `45` rows, `45` approvals, `37.8%` winrate, `avg_profit = +2.75`

Immediate interpretation:

- raw classification accuracy is not the headline metric here
- the important change is that approved expectancy turned positive
- the stream is now much narrower and materially cleaner
- this is the first recent `VolumeDivergence` replay window that looks directionally promising

## Comparison vs previous snapshot

Compared to the previous `latest 500` snapshot in this file:

- `accuracy`: `67.2% -> 66.0%`
- `TP`: `20 -> 17`
- `FP`: `70 -> 28`
- `TN`: `316 -> 313`
- `FN`: `94 -> 142`
- `approved`: `90 -> 45`
- `precision_approved`: `22.2% -> 37.8%`
- `recall_winners`: `17.5% -> 10.7%`
- `avg_profit_all`: `-4.20 -> -0.20`
- `avg_profit_approved`: `-4.22 -> +2.75`
- `expectancy_delta`: `-0.02 -> +2.94`

Interpretation:

- `NORMALIZATION_LENGTH = 120` plus the current adapter calibration sharply reduced false approvals
- the tradeoff is obvious: recall fell and FN rose
- but unlike the `80` window, the narrower approval stream is now actually better than the all-trades baseline
- this is a much healthier failure mode than before

## Main discovery: `LONG q4 confirmation_ready` is still dominant, but no longer uniformly bad

The current replay is still dominated by one pocket:

- `LONG | q4 | confirmation_ready = 43` approvals
- winrate `37.2%`
- `avg_profit = +2.57`

Deeper split of approved rows:

- `LONG | q4 | confirmation_ready | coinAgainst | btcAgainst = 34`
  - winrate `26.5%`
  - `avg_profit = -2.25`
- `LONG | q4 | confirmation_ready | coinAlign | btcAgainst = 5`
  - winrate `60.0%`
  - `avg_profit = +12.78`
- `LONG | q4 | confirmation_ready | coinAgainst | btcAlign = 2`
  - winrate `100.0%`
  - `avg_profit = +30.71`
- `LONG | q4 | confirmation_ready | coinAlign | btcAlign = 2`
  - winrate `100.0%`
  - `avg_profit = +30.71`

This means:

- the dominant `LONG q4` lane is no longer globally broken
- but one large sub-pocket inside it is still weak: `coinAgainst | btcAgainst`
- the recent adapter demotions likely helped a lot, but that sub-pocket still needs more cleanup

## Direction asymmetry is now explicit

Current behavior:

- `SHORT` is still precise but almost absent
- `LONG` still carries almost all approvals
- unlike the previous window, `LONG` is no longer uniformly toxic

Evidence:

- `SHORT approved = 2`, `TP = 1`, `FP = 1`
- `LONG approved = 43`, `TP = 16`, `FP = 27`

Practical interpretation:

- the strategy is still not symmetric
- `SHORT` remains a tiny research branch
- `LONG` is the real tradable lane, and now it at least has positive approved expectancy

## FN reading

False negatives are even more clearly score-ladder cases now.

Most profitable rejected rows are:

- `LONG | q3 | confirmation_ready = 83`, `avg_profit = +30.71`
- `SHORT | q2 | confirmation_ready = 31`, `avg_profit = +27.39`
- `SHORT | q3 | confirmation_ready = 19`, `avg_profit = +27.39`
- `LONG | q2 | confirmation_ready = 9`, `avg_profit = +30.71`

Hard-block split of FN:

- `none = 137`
- `weak_divergence_amplitude = 5`

Meaning:

- the system is definitely not losing winners because of structural vetoes
- it is losing them because the current `q3` bucket is full of profitable confirmed reversals

This is now the main tradeoff:

- approved stream is positive
- but recall is still too low
- so the next move should be selective `q3 -> q4` expansion, not another blanket tightening

## Feature reading: what separates approved winners from approved losers

Comparing approved winners vs approved losers:

- `divergenceAmplitudeAtrRatio`
  - winners avg `1.64`
  - losers avg `2.51`
- `reclaimPct`
  - winners avg `187.05`
  - losers avg `185.94`
  - but median is more informative: winners `169.90`, losers `137.10`
- `confirmationCandleQuality`
  - winners avg `0.802`
  - losers avg `0.814`
- `atrPct`
  - winners avg `0.689`
  - losers avg `1.046`
- `volumeDivergenceRatio`
  - winners avg `2.66`
  - losers avg `3.38`
- `barsSinceDetection`
  - winners avg `6.12`
  - losers avg `4.29`

Most useful interpretation:

- lower amplitude is still better than oversized amplitude
- lower volatility (`atrPct`) is a meaningful positive sign
- slightly more mature confirmations appear better than immediate ones
- `volumeDivergenceRatio` is no longer a clean positive separator after the latest adapter changes

This is important because it weakens the earlier hypothesis that simply increasing weight on `volumeDivergenceRatio` would solve the lane.

## Best and worst pockets

Best visible approved pockets:

- `LONG | q4 | confirmation_ready | coinAgainst | btcAlign = 2`
  - winrate `100.0%`
  - `avg_profit = +30.71`
- `LONG | q4 | confirmation_ready | coinAlign | btcAlign = 2`
  - winrate `100.0%`
  - `avg_profit = +30.71`
- `LONG | q4 | confirmation_ready | coinAlign | btcAgainst = 5`
  - winrate `60.0%`
  - `avg_profit = +12.78`
- `SHORT | q4 | confirmation_ready | coinAlign | btcAlign = 2`
  - winrate `50.0%`
  - `avg_profit = +6.64`

These are still small samples, but they show the lane is no longer uniformly broken.

Worst dominant pocket:

- `LONG | q4 | confirmation_ready | coinAgainst | btcAgainst = 34`
- winrate `26.5%`
- `avg_profit = -2.25`

Secondary bad pocket:

- `SHORT | q4 | confirmation_ready = 2` is too small to optimize around

So the next cleanup target is still obvious:

- keep refining the big `LONG | q4 | confirmation_ready | coinAgainst | btcAgainst` cluster

## What to improve next

### 1. Strategy core

Do not reopen `structure_advance`.

Current evidence still says the next core change should be feature quality, not timing looseness.

The most promising new core feature candidate is:

- explicit maturity / freshness after detection

Because winners in the approved set now tend to have slightly larger `barsSinceDetection` than losers.

So if the core changes again, it should probably be in the direction of:

- exposing more explicit post-detection maturity features
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

Current adapter should move in two opposite directions at once.

The adapter changes below are now partly validated by this replay:

- demotion of overheated `LONG q4 confirmation_ready` helped materially
- selective `LONG q3 -> q4` promotion did not reopen the old bad `80`-window lane

But the current replay also falsifies one earlier assumption:

- `volumeDivergenceRatio` is not a clean positive separator anymore

So the next adapter improvement should be:

- keep the amplitude-cap logic
- keep selective promotion
- avoid increasing raw weight on `volumeDivergenceRatio` further
- instead consider:
  - a mild preference for lower `atrPct`
  - a mild preference for larger `barsSinceDetection`
  - additional demotion of the large `coinAgainst | btcAgainst` `LONG q4` pocket

## Code changes applied on 2026-04-14

The adapter changes from `2026-04-14` are now replayed on a fresh export.

Observed effect:

- `approved: 90 -> 45`
- `FP: 70 -> 28`
- `avg_profit_approved: -4.22 -> +2.75`
- `expectancy_delta: -0.02 -> +2.94`

So the current adapter branch is worth keeping and iterating on.

## Practical current verdict

Current `VolumeDivergence` is still not ready for production, but this is the first recent replay where the approved stream is actually better than the baseline.

The important result of this replay:

- approved expectancy is positive
- the approval stream is narrower and cleaner
- `LONG` is now a plausible research lane instead of a clearly broken one
- the main remaining problem is low recall, not negative approved expectancy

So the next move should be:

1. keep the current adapter branch
2. rerun the same `NORMALIZATION_LENGTH = 120` detector point after any further adapter changes
3. work on selective `LONG q3 confirmation_ready` promotion
4. avoid reopening early/weak lanes just to chase recall
