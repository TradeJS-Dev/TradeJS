# VolumeDivergence AI Replay Notes

Last updated: 2026-04-11.

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
data/ai/export/ai-dataset-volumedivergence-merged-1775855912483.jsonl
```

Current Redis config `VolumeDivergence:ai`:

```json
{
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

- this config does not explore the detector at all
- it only explores TP/SL
- so if signal quality is bad, this grid cannot fix the core problem

## Deterministic replay setup

For this investigation, `ai-train` was extended with:

- `--localOnly`
- deterministic gate extraction from strategy AI payload

Current local replay command:

```bash
yarn ai-train --strategy VolumeDivergence -n 500 --localOnly
```

This replay does not call OpenRouter.

It measures the deterministic adapter gate that sits between:

- strategy-produced entry rows
- final `approve now / watch / reject` decision

## Critical adapter fix found during investigation

During the replay audit, a concrete bug was found:

- `core.ts` writes `additionalIndicators.deltaAtPivot`
- `adapters/ai.ts` was reading `currentPivotDelta`

Because of this mismatch:

- `deltaAligned` was always `null`
- one of the intended scoring features was effectively dead

After fixing the key mismatch:

- replay improved from `accuracy 71.8%` to `73.4%`
- `precision_approved` improved from `16.7%` to `20.0%`
- `expectancy_delta` improved from `-1.25` to `+0.22`

This was a real bugfix, not just a metric trick.

## Replay result: `latest 500`

Local deterministic replay after the `deltaAtPivot` fix:

- `accuracy = 73.4%`
- `TP/FP/TN/FN = 12 / 48 / 355 / 85`
- `approved = 60`
- `precision_approved = 20.0%`
- `recall_winners = 12.4%`
- `avg_profit_all = -5.59`
- `avg_profit_approved = -5.37`
- `expectancy_delta = +0.22`

Direction split:

- `LONG`: `8 / 19 / 190 / 63`
- `SHORT`: `4 / 29 / 165 / 22`

Deterministic flow:

- `selected = 500`
- `core_blocked_now = 81`
- `adapter_blocked_now = 359`
- `left_to_model_now = 60`

Quality breakdown:

- `quality=4`: `84` rows, `32` approvals, `22.6%` winrate, `avg_profit = -4.21`
- `quality=5`: `28` rows, `28` approvals, `14.3%` winrate, `avg_profit = -7.94`

Immediate interpretation:

- current gate is still not good
- `quality=5` is worse than `quality=4`
- approved trades are only slightly less bad than the full population
- this is not a useful production-quality AI filter yet

## Main discovery: core and adapter are misaligned

This is the most important finding.

`VolumeDivergence core` enters immediately when divergence is found.

But the adapter says:

- `359 / 500` latest rows are still `watch`, not `approve now`
- only `60 / 500` rows are actually strong enough for immediate approval

Meaning:

- the strategy is firing much earlier than the AI gate considers structurally confirmed
- the adapter is not acting like a mild refinement layer
- it is acting like a rescue layer for a timing problem created earlier in the pipeline

This is different from the stronger `TrendLine` / `ReverseTrendLine` setups, where deterministic guardrails are much closer to the strategy’s actual timing model.

## Quality ladder is broken

Current `VolumeDivergence` scoring is not calibrated well:

- `quality=5` performs worse than `quality=4`
- approval count is already small
- even within that small set, the highest bucket is not the best bucket

This means:

- `quality` is not currently a reliable signal
- tightening `MIN_AI_QUALITY` alone will not save the strategy
- first the ladder itself must be reweighted

## Direction asymmetry

`LONG` is weak, but `SHORT` is materially worse.

Approved direction performance on `latest 500`:

- `LONG`: `27` approvals, `8` wins, total approved profit about `-22.4`
- `SHORT`: `32` approvals, `3` wins, total approved profit about `-327.0`

Practical conclusion:

- the bearish branch is the bigger problem
- if this strategy were being hardened for production today, `SHORT` should be tightened first or even temporarily disabled while reworking the detector

## Best and worst pockets

The strongest pocket found on this window:

- `LONG | q4 | coin_bad | btc_bad | delta_ok`
- `5` approvals
- `3` wins
- `avgProfit = +12.78`

Interpretation:

- bullish divergence works best as a true counter-trend reversal pocket
- bearish MA bias on both coin and BTC is not automatically bad here
- positive delta at the pivot is useful for this `LONG` pocket

The worst recurring pockets:

- `SHORT | q4 | coin_bad | btc_bad | delta_ok`
  - `8` approvals
  - `0` wins
  - `avgProfit = -14.11`
- `SHORT | q5 | coin_bad | btc_ok | delta_ok`
  - `6` approvals
  - `0` wins
  - `avgProfit = -14.11`

Interpretation:

- the current bearish scoring is approving continuation-like losers
- for `SHORT`, the present bias/delta treatment is not separating good reversals from bad ones

## FN reading

The dominant false-negative clusters are:

- `watch | q3 | coin_bad | btc_bad | delta_bad`
- `watch | q3 | coin_bad | btc_ok | delta_bad`
- many `watch` cases with:
  - `nostructure`
  - `rebound < 0.25%`

This strongly suggests:

- many future winners begin as early watch states
- the right fix is probably not “approve these immediately”
- the right fix is to carry them forward as pending divergence candidates and wait for later confirmation

In other words:

- FN reduction here likely requires stateful follow-up
- not just looser same-bar thresholds

## What to improve next

### 1. Strategy core

Highest-priority change:

- stop entering immediately on raw divergence detection
- store a pending divergence candidate
- keep watching for `N` bars
- enter only when one of these becomes true:
  - `confirmationReady=true`
  - structure clearly advanced away from the pivot
  - rebound from pivot crosses a deterministic threshold

This would align the core with what the adapter is already trying to say.

Also recommended:

- split `LONG` and `SHORT` confirmation logic
- do not assume symmetric reversal behavior
- consider making `SHORT` stricter than `LONG`

### 2. Backtest config

Do not keep tuning only TP/SL at this stage.

The current grid explores exits but not the detector.

The next useful search should include:

- `NORMALIZATION_LENGTH`
- `PIVOT_LOOKBACK_LEFT`
- `PIVOT_LOOKBACK_RIGHT`
- `MIN_BARS_BETWEEN_PIVOTS`
- `MAX_BARS_BETWEEN_PIVOTS`

Suggested next detector grid:

```json
{
  "NORMALIZATION_LENGTH": [64, 96, 144],
  "PIVOT_LOOKBACK_LEFT": [5, 8, 13],
  "PIVOT_LOOKBACK_RIGHT": [2, 3, 5],
  "MIN_BARS_BETWEEN_PIVOTS": [2, 4, 6],
  "MAX_BARS_BETWEEN_PIVOTS": [24, 36, 48]
}
```

Practical search order:

1. `LONG` only
2. detector grid
3. then TP/SL
4. only after that re-open `SHORT`

### 3. AI adapter

Current adapter should be improved in three ways.

First:

- stop rewarding MA bias alignment symmetrically
- for reversal logic, alignment is not always good
- the best `LONG` pocket here is explicitly counter-trend

Second:

- make `quality=5` much harder to reach
- require stronger structure, not just cumulative score
- example requirement:
  - `confirmationReady=true`
  - `structureAdvanced=true`
  - `reboundFromPivotPct >= 0.6`
  - no major bias/delta conflicts

Third:

- treat `deltaAtPivot` asymmetrically by direction
- current `LONG` evidence likes `delta_ok`
- current `SHORT` evidence does not support a naive mirror rule

Recommended adapter additions for future replay analysis:

- explicit `entryTiming`
- explicit `approvalReason`
- explicit `rejectionLane`

This would make future FP/FN clustering faster and cleaner.

## Practical current verdict

Current `VolumeDivergence` state is not comparable to the stronger replayable setups.

Best practical reading right now:

- the detector timing is too early
- the adapter is trying to compensate for a core problem
- the current quality ladder is not trustworthy
- `SHORT` is especially weak

So the next move should be:

1. fix core timing with pending confirmation logic
2. search detector params, not just exits
3. then recalibrate the adapter on the new export
