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
data/ai/export/ai-dataset-volumedivergence-merged-1775909347993.jsonl
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

Local deterministic replay on the current export:

- `accuracy = 73.6%`
- `TP/FP/TN/FN = 9 / 32 / 359 / 100`
- `approved = 41`
- `precision_approved = 22.0%`
- `recall_winners = 8.3%`
- `avg_profit_all = -4.58`
- `avg_profit_approved = -4.27`
- `expectancy_delta = +0.31`

Direction split:

- `LONG`: `9 / 30 / 151 / 64`
- `SHORT`: `0 / 2 / 208 / 36`

Deterministic flow:

- `selected = 500`
- `core_blocked_now = 0`
- `adapter_blocked_now = 459`
- `left_to_model_now = 41`

Quality breakdown:

- `quality=2`: `159` rows, `0` approvals, `16.4%` winrate, `avg_profit = -7.22`
- `quality=3`: `300` rows, `0` approvals, `24.7%` winrate, `avg_profit = -3.22`
- `quality=4`: `38` rows, `38` approvals, `23.7%` winrate, `avg_profit = -3.49`
- `quality=5`: `3` rows, `3` approvals, `0.0%` winrate, `avg_profit = -14.11`

Window composition:

- `LONG rows = 254`
- `SHORT rows = 246`
- `entryTiming = structure_advance` on `351 / 500`
- `entryTiming = confirmation_ready` on `149 / 500`

Immediate interpretation:

- the filter is stricter than before and it did cut a visible chunk of false positives
- `quality=5` became much rarer, which was the right move
- but `quality=4` is still not a profitable bucket on this window
- approvals are still almost entirely a `LONG` problem, while `SHORT` is now close to fully suppressed

## Comparison vs previous snapshot

Compared to the previous `latest 500` note in this file:

- `accuracy`: `72.4% -> 73.6%`
- `FP`: `41 -> 32`
- `TP`: `12 -> 9`
- `FN`: `97 -> 100`
- `approved`: `53 -> 41`
- `precision_approved`: `22.6% -> 22.0%`
- `avg_profit_all`: `-4.58 -> -4.58`
- `avg_profit_approved`: `-4.02 -> -4.27`
- `expectancy_delta`: `+0.55 -> +0.31`
- `quality=5 count`: `25 -> 3`

Interpretation:

- the latest tightening improved raw classification accuracy and reduced false approvals
- but it also removed some true positives and reduced recall
- the `q5` explosion was fixed, but the promoted `q4` bucket is still weak
- this was a useful calibration step, not a finished solution

## Main discovery: the timing problem moved, but did not disappear

The old version entered too early on raw divergence.

That specific issue was improved by the pending-confirmation flow.

But the new replay shows a second-order mismatch:

- `core_blocked_now = 0`
- `adapter_blocked_now = 447`
- only `53 / 500` rows are allowed through the deterministic adapter gate

Meaning:

- the strategy now waits until `confirmation_ready` or `structure_advance`
- the extra rebound guard on `structure_advance` helped, but did not materially reduce adapter dependence
- the adapter is still doing most of the real filtering work

So the core is closer to the adapter than before, but the two layers are still not aligned.

The practical version of this finding:

- `raw divergence -> pending` was the right first move
- the next move is to make `entry_structure_advance` itself stricter
- otherwise the adapter keeps acting like a late rescue layer

## Quality ladder is still broken

The strongest single finding on this window is still the quality ladder:

- `quality=5` is now rare, which is correct
- but the remaining `quality=5` rows are still the worst rows
- `quality=4` became the main approved bucket, but it is still negative on average

This is not a cosmetic issue.

It means the ladder is inverted at the top:

- the system is most confident exactly where it should be most skeptical

Practical conclusion:

- `MIN_AI_QUALITY = 5` is still a mistake here
- `quality=5` is now almost gone, but the remaining lane still should not exist in its current form
- if `quality=4` remains the approval bucket, it has to become materially cleaner before this strategy is production-worthy

## Direction asymmetry changed

The previous snapshot already shifted risk toward `LONG`.

The new snapshot makes that even more explicit:

- `SHORT` approvals almost disappeared: only `2`
- `LONG` approvals dominate: `39`
- all true positives on this window are `LONG`
- most remaining false positives are approved `LONG`

So current behavior is:

- `SHORT` is mostly being rejected
- `LONG` is where the adapter still takes the wrong bets

This does not mean `SHORT` is solved.

It means:

- `SHORT` recall is now effectively zero on this window
- `LONG` precision is still poor
- the system is simultaneously too conservative on `SHORT` and still too tolerant of weak `LONG` reversal approvals

## Best and worst pockets

Compared to the previous snapshot, the visible pocket rotation is now clear even without another deep cluster dump:

- `quality=5` was cut from `25` rows to `3`
- `approved` was cut from `53` to `41`
- `FP` was cut from `41` to `32`
- but `TP` also fell from `12` to `9`

Interpretation:

- the bad `LONG q5 structure_advance` lane was largely removed
- the remaining issue moved one level down into `q4`
- the strategy is now less reckless, but not yet selective enough where it approves

This repeats the earlier theme from `ReverseTrendLine`:

- reversal setups should not automatically reward alignment with current MA bias

## FN reading

The new FN profile is simpler to read from the aggregate metrics:

- `FN` rose from `97` to `100`
- `LONG` is still where the winners are
- `SHORT` produced zero approved winners on this window

Important interpretation:

- the new guardrail did remove bad approvals
- but it also demoted some real `LONG` winners out of the approval set
- the next FN fix should therefore be selective score recalibration, not another blanket tightening step

## What to improve next

### 1. Strategy core

The pending-candidate layer is already the right direction.

The next core improvement should be narrower:

- keep the new extra rebound threshold on `entry_structure_advance`
- do not add another blanket timing gate yet
- the next core step should be to improve the quality of candidates before they reach `pending`, not to keep stacking waits after detection

Concretely:

- preserve `LONG confirmation_ready` as the cleaner aggressive lane
- keep `SHORT` strict for now
- explore detector params before touching exit logic again

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

Current adapter should be improved in four ways.

First:

- remove the remaining `quality=5` lane entirely or make it confirmation-only
- current evidence still does not justify any live use of `q5`

Second:

- improve `quality=4`, because that is now the real approval bucket
- the current `q4` bucket is still negative on average

Third:

- keep avoiding automatic reward for MA-bias alignment on `LONG`
- reversal context should stay more important than alignment bias

Fourth:

- selectively re-open some `LONG q3 confirmation_ready` winners into `q4`
- do not broadly re-open `structure_advance`; that would likely just restore the old FP problem

Recommended concrete adapter experiment:

- `LONG confirmation_ready`:
  - allow `q4` more often, even with some bias conflict
- `LONG structure_advance`:
  - keep capped below the old `q5` behavior
  - require stronger evidence than generic rebound + volume
- `SHORT`:
  - keep strict for now
  - do not widen until the detector itself is explored

## Practical current verdict

Current `VolumeDivergence` is still behind the stronger replayable setups.

Best practical reading right now:

- the new tightening removed a clearly bad high-confidence lane
- but it did not improve approved expectancy enough
- `LONG` remains the only realistically tradable side for now
- `SHORT` is still more useful as a research branch than as a live branch

So the next move should be:

1. search detector params, not just exits
2. remove or nearly eliminate `quality=5`
3. recalibrate `LONG q4 confirmation_ready` separately from `LONG q4 structure_advance`
4. keep `SHORT` strict until detector research shows a cleaner base signal
