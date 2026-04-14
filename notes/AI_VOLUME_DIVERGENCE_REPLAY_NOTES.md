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
data/ai/export/ai-dataset-volumedivergence-merged-1776164708075.jsonl
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

- `accuracy = 81.6%`
- `TP/FP/TN/FN = 7 / 14 / 401 / 78`
- `approved = 21`
- `precision_approved = 33.3%`
- `recall_winners = 8.2%`
- `avg_profit_all = -2.03`
- `avg_profit_approved = +3.68`
- `expectancy_delta = +5.70`

Direction split:

- `LONG`: `7 / 12 / 219 / 57`, `approved = 19`
- `SHORT`: `0 / 2 / 182 / 21`, `approved = 2`

Deterministic flow:

- `selected = 500`
- `core_blocked_now = 8`
- `adapter_blocked_now = 471`
- `left_to_model_now = 21`

Quality breakdown:

- `quality=2`: `144` rows, `0` approvals, `10.4%` winrate, `avg_profit = -4.46`
- `quality=3`: `335` rows, `0` approvals, `18.8%` winrate, `avg_profit = -1.34`
- `quality=4`: `21` rows, `21` approvals, `33.3%` winrate, `avg_profit = +3.68`

Immediate interpretation:

- raw classification accuracy is not the headline metric here
- the approval stream got much smaller again
- approved expectancy stayed positive and even improved
- the system is now clearly trading selectivity for recall
- this is a healthier regime than the earlier wide-approval windows, but the sample is now very small

## Comparison vs previous snapshot

Compared to the previous `latest 500` snapshot in this file:

- `accuracy`: `66.0% -> 81.6%`
- `TP`: `17 -> 7`
- `FP`: `28 -> 14`
- `TN`: `313 -> 401`
- `FN`: `142 -> 78`
- `approved`: `45 -> 21`
- `precision_approved`: `37.8% -> 33.3%`
- `recall_winners`: `10.7% -> 8.2%`
- `avg_profit_all`: `-0.20 -> -2.03`
- `avg_profit_approved`: `+2.75 -> +3.68`
- `expectancy_delta`: `+2.94 -> +5.70`

Interpretation:

- the current branch became materially stricter
- approvals halved again, and false approvals halved too
- precision slipped slightly, but approved expectancy improved
- the biggest positive shift is `TN: 313 -> 401`, which means the adapter is now much more conservative
- the cost is that the tradable stream is getting very small, so the next risk is under-trading rather than over-approving

## Main discovery: `LONG q4 confirmation_ready` remains the whole game, but now only one sub-pocket is still bad

The current replay is still dominated by one pocket:

- `LONG | q4 | confirmation_ready = 19` approvals
- winrate `36.8%`
- `avg_profit = +5.03`

Deeper split of approved rows:

- `LONG | q4 | confirmation_ready | coinAgainst | btcAgainst = 13`
  - winrate `23.1%`
  - `avg_profit = -1.47`
- `LONG | q4 | confirmation_ready | coinAlign | btcAgainst = 3`
  - winrate `66.7%`
  - `avg_profit = +19.09`
- `LONG | q4 | confirmation_ready | coinAgainst | btcAlign = 2`
  - winrate `100.0%`
  - `avg_profit = +30.71`
- `LONG | q4 | confirmation_ready | coinAlign | btcAlign = 1`
  - winrate `0.0%`
  - `avg_profit = -4.15`
- `SHORT | q4 | confirmation_ready | coinAlign | btcAlign = 2`
  - winrate `0.0%`
  - `avg_profit = -9.13`

This means:

- the dominant `LONG q4` lane is still the only real approval lane
- one large sub-pocket inside it is still weak: `coinAgainst | btcAgainst`
- the aligned or semi-aligned `LONG` pockets are now clearly better than the fully conflicting one
- `SHORT q4` is currently too small and too weak to optimize around

## Direction asymmetry is now explicit

Current behavior:

- `SHORT` is still almost absent and currently not useful
- `LONG` carries almost all approvals
- the approval stream is now basically a `LONG confirmation_ready` research lane

Evidence:

- `SHORT approved = 2`, `TP = 0`, `FP = 2`
- `LONG approved = 19`, `TP = 7`, `FP = 12`

Practical interpretation:

- the strategy is still not symmetric
- `SHORT` remains a tiny research branch
- `LONG` is still the only lane with practical promise
- if the next step is lane cleanup, it should still focus on `LONG`

## FN reading

False negatives are even more clearly score-ladder cases now.

Most profitable rejected rows are:

- `LONG | q3 | confirmation_ready | coinAgainst | btcAgainst = 26`, `avg_profit = +30.71`
- `LONG | q3 | confirmation_ready | coinAgainst | btcAlign = 12`, `avg_profit = +30.71`
- `LONG | q3 | confirmation_ready | coinAlign | btcAgainst = 9`, `avg_profit = +30.71`
- `LONG | q3 | confirmation_ready | coinAlign | btcAlign = 7`, `avg_profit = +30.71`

Hard-block split of FN:

- `none = 75`
- `weak_divergence_amplitude = 3`

Meaning:

- the system is definitely not losing winners because of structural vetoes
- it is losing them because a big part of the profitable confirmed `LONG q3` bucket still does not get promoted

This is now the main tradeoff:

- approved stream is positive
- but recall is still low
- so the next move should be selective `q3 -> q4` expansion inside the `LONG confirmation_ready` lane, not another global tightening

## Feature reading: what separates approved winners from approved losers

Comparing approved winners vs approved losers:

- `divergenceAmplitudeAtrRatio`
  - winners avg `1.70`
  - losers avg `1.99`
- `reclaimPct`
  - winners avg `227.25`
  - losers avg `189.06`
- `confirmationCandleQuality`
  - winners avg `0.769`
  - losers avg `0.845`
- `confirmationDistancePct`
  - winners avg `0.92`
  - losers avg `3.10`
- `atrPct`
  - winners avg `0.695`
  - losers avg `1.236`
- `volumeDivergenceRatio`
  - winners avg `2.71`
  - losers avg `2.84`
- `barsSinceDetection`
  - winners avg `3.86`
  - losers avg `6.36`

Most useful interpretation:

- lower amplitude is still better than oversized amplitude
- lower volatility (`atrPct`) is still a meaningful positive sign
- higher reclaim is more useful than “stronger candle quality”
- larger `confirmationDistancePct` is not automatically better; oversized post-confirmation extension now looks worse
- longer maturity is no longer clearly positive; in this snapshot approved losers are actually older than winners
- `volumeDivergenceRatio` remains weak as a separator

This is important because it weakens the earlier hypothesis that simply increasing weight on `volumeDivergenceRatio` would solve the lane.

## Best and worst pockets

Best visible approved pockets:

- `LONG | q4 | confirmation_ready | coinAgainst | btcAlign = 2`
  - winrate `100.0%`
  - `avg_profit = +30.71`
- `LONG | q4 | confirmation_ready | coinAlign | btcAgainst = 3`
  - winrate `66.7%`
  - `avg_profit = +19.09`

These are still small samples, but they show the lane is no longer uniformly broken.

Worst dominant pocket:

- `LONG | q4 | confirmation_ready | coinAgainst | btcAgainst = 13`
- winrate `23.1%`
- `avg_profit = -1.47`

Secondary bad pocket:

- `SHORT | q4 | confirmation_ready | coinAlign | btcAlign = 2`
- winrate `0.0%`
- `avg_profit = -9.13`

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

So the next adapter improvement should be:

- keep the amplitude-cap logic
- keep selective promotion, but only in the `LONG confirmation_ready` lane
- avoid increasing raw weight on `volumeDivergenceRatio` further
- instead consider:
  - a mild preference for lower `atrPct`
  - a mild preference for higher `reclaimPct`
  - a mild penalty for oversized `confirmationDistancePct`
  - additional demotion of the large `coinAgainst | btcAgainst` `LONG q4` pocket

## Code changes applied on 2026-04-14

The current adapter branch is now replayed on a fresh export.

Observed effect:

- `approved: 45 -> 21`
- `FP: 28 -> 14`
- `avg_profit_approved: +2.75 -> +3.68`
- `expectancy_delta: +2.94 -> +5.70`

So the current adapter branch is worth keeping and iterating on.

## Practical current verdict

Current `VolumeDivergence` is still not ready for production, but this is the first recent replay where the approved stream is actually better than the baseline.

The important result of this replay:

- approved expectancy is positive
- the approval stream is even narrower and cleaner
- `LONG` remains the only plausible research lane
- the main remaining problem is still low recall, not negative approved expectancy
- the next risk is under-trading if the adapter gets any stricter

So the next move should be:

1. keep the current adapter branch
2. rerun the same `NORMALIZATION_LENGTH = 120` detector point after any further adapter changes
3. work on selective `LONG q3 confirmation_ready` promotion
4. keep targeting the `coinAgainst | btcAgainst` `LONG q4` cluster
5. avoid reopening early/weak lanes just to chase recall
