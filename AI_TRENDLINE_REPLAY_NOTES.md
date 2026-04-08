# TrendLine AI Replay Notes

Last updated: 2026-04-08.

This file keeps internal notes for `ai-train` replay windows and TrendLine AI gate analysis.

## Window `--skip 100 -n 100`

Command:

```bash
yarn ai-train --skip 100 -n 100 --rebuildPrompts -p 3 --model openai/gpt-5-mini
```

Replay result:

- `accuracy = 66.0%`
- `TP/FP/TN/FN = 2 / 0 / 64 / 34`
- `precision_approved = 100.0%`
- `recall_winners = 5.6%`
- `avg_profit_all = 0.29`
- `avg_profit_approved = 26.50`
- `expectancy_delta = 26.21`

Main finding:

- the bottleneck in this window is not the model itself
- for the dominant symbol clusters, `TrendLine` deterministic guardrails already set `approvalAllowedNow=false`
- after that, adapter post-processing forces `direction=null`, `needRetest=true`, and caps quality below approval

Dominant clusters in the window:

- `IRYSUSDT`: `4` rows, all profitable, but all blocked by `no_clear_break + near_line_noise + coin_bias_conflict + btc_bias_conflict`
- `JELLYJELLYUSDT`: `12` rows, mixed winners/losers, mostly blocked by `no_clear_break + near_line_noise + btc_bias_conflict`
- `JSTUSDT`: `38` rows, mixed, only potentially interesting profitable-only subcluster is `no_clear_break + btc_bias_conflict`
- `JUPUSDT`: `12` rows, losers are usefully blocked by `weak_btc_led_break`, profitable rows are not clean enough for a safe exception
- `KAIAUSDT`: `16` rows, repeated profitable early-break cluster exists, but looks too local and likely overfit

Current conclusion:

- do not relax `IRYSUSDT`, `JELLYJELLYUSDT`, `JUPUSDT`, or `KAIAUSDT` guardrails yet
- if continuing, inspect only the `JSTUSDT` `no_clear_break + btc_bias_conflict` subcluster as a candidate for a narrow adapter-level exception

## Window `--skip 200 -n 100`

Command:

```bash
yarn ai-train --skip 200 -n 100 --rebuildPrompts -p 3 --model openai/gpt-5-mini
```

Replay result:

- `accuracy = 74.0%`
- `TP/FP/TN/FN = 8 / 2 / 66 / 24`
- `precision_approved = 80.0%`
- `recall_winners = 25.0%`
- `avg_profit_all = -1.36`
- `avg_profit_approved = 18.38`
- `expectancy_delta = 19.74`

Main finding:

- this window is structurally healthier than `--skip 100 -n 100`
- approvals happen only inside clusters where deterministic TrendLine gate already allows entry (`approvalAllowedNow=true`)
- dominant missed clusters are again blocked at adapter level before model wording can materially change the outcome

Dominant symbol families:

- `IOTXUSDT`: `22` rows, `6` winners, `16` losers, all blocked by `no_clear_break` with optional `near_line_noise` / `btc_bias_conflict`
- `IOSTUSDT`: `20` rows, `10` winners, `10` losers, all blocked, mixed reasons across `no_clear_break`, `near_line_noise`, and bias conflicts
- `IOTAUSDT`: `16` rows, `4` winners, `12` losers, all blocked, mostly `no_clear_break + near_line_noise`
- `INUSDT`: `14` rows, `4` winners, `10` losers, only `4` rows are structurally allowed; among them `2` winners and `2` losers
- `IOUSDT`: `12` rows, `6` winners, `6` losers, `4` structurally allowed rows and all `4` are winners
- `IPUSDT`: `4` rows, `2` winners, `2` losers, `2` structurally allowed rows and both are winners

Current conclusion:

- this window is not dominated by one obviously over-strict cluster like the previous `skip 100` window
- `IOUSDT` and `IPUSDT` show healthy behavior: when structure is clean, approvals line up with winners
- `INUSDT` is the current source of false positives inside structurally allowed setups
- `IOTXUSDT`, `IOSTUSDT`, and `IOTAUSDT` remain mostly adapter-level reject territory, so improvements there should target deterministic guardrails first, not model swapping

## Follow-up analysis: `INUSDT` false positives

Window:

```bash
yarn ai-train --skip 200 -n 100 --rebuildPrompts -p 3 --model openai/gpt-5-mini
```

Findings:

- both `FP` in this window come from `INUSDT`
- all `4` structurally allowed `INUSDT` rows are identical on current TrendLine context fields:
  - `clearBreak=true`
  - `nearLineNoise=false`
  - `priceVsLinePct=-0.459`
  - `breakVsAtrRatio=0.405`
  - `touches=4`
  - `distance=132`
- those `4` identical rows split into `2` winners and `2` losers

Interpretation:

- this is not a model-specific distinction problem
- current adapter treats this as a fully clean break and gives `approvalAllowedNow=true`
- but on replay history this exact weak-break pattern behaves like a coin-flip

Comparison:

- healthy approved winners in the same window (`IOUSDT`, `IPUSDT`) are much stronger:
  - `IOUSDT`: `priceVsLinePct=-1.273`, `breakVsAtrRatio=1.287`
  - `IPUSDT`: `priceVsLinePct=-2.002`, `breakVsAtrRatio=1.841`

Practical takeaway:

- if tightening is needed, the right target is not the model but a stricter clean-break filter for marginal `clearBreak=true` setups with low displacement
- a plausible next hypothesis is to cap quality or block approval when break strength is still too small despite formal `clearBreak=true`

## Follow-up analysis: can guardrails be relaxed for `IOST` / `IOTX` / `IOTA`?

`IOTXUSDT`:

- no safe profitable-only cluster found
- block buckets:
  - `["no_clear_break"]`: `2` winners / `6` losers
  - `["no_clear_break","near_line_noise"]`: `4` winners / `6` losers
  - `["no_clear_break","near_line_noise","btc_bias_conflict"]`: `0` winners / `4` losers
- conclusion: do not relax

`IOTAUSDT`:

- one profitable-only bucket exists:
  - `["no_clear_break","near_line_noise","btc_bias_conflict"]`: `4` winners / `0` losers
- but the generic neighbor bucket is strongly bad:
  - `["no_clear_break","near_line_noise"]`: `0` winners / `12` losers
- conclusion: no safe generic relaxation; the `4/0` pocket looks too narrow and suspicious

`IOSTUSDT`:

- two profitable-only buckets exist:
  - `["no_clear_break","near_line_noise","btc_bias_conflict"]`: `4` winners / `0` losers
  - `["no_clear_break"]`: `4` winners / `0` losers
- but nearby buckets are mixed or bad:
  - `["no_clear_break","near_line_noise","coin_bias_conflict","btc_bias_conflict"]`: `2` winners / `2` losers
  - `["no_clear_break","near_line_noise"]`: `0` winners / `4` losers
  - `["no_clear_break","coin_bias_conflict"]`: `0` winners / `4` losers

Current conclusion:

- `IOTXUSDT`: no candidate for relaxation
- `IOTAUSDT`: not enough evidence for safe relaxation
- `IOSTUSDT`: only symbol worth revisiting later, but current evidence is still too local for a generic rule

## Guardrail change: weak clean break

Implemented in `TrendLine` AI adapter:

- new structural hard block `weak_clean_break`
- condition: `clearBreak=true`, `nearLineNoise=false`, and `breakVsAtrRatio < 0.45`

Motivation:

- in analyzed windows this catches the exact `INUSDT` false-positive pattern
- on `latest500` the same condition matched only two repeated symbol-patterns:
  - `INUSDT`: `2` winners / `2` losers
  - `HIVEUSDT`: `2` winners / `2` losers
- this is not a strong edge pattern; it behaves like a coin flip despite formal `clearBreak=true`

Replay check:

```bash
yarn ai-train --skip 200 -n 100 --rebuildPrompts -p 3 --model openai/gpt-5-mini
```

Before:

- `accuracy = 74.0%`
- `TP/FP/TN/FN = 8 / 2 / 66 / 24`
- `precision_approved = 80.0%`
- `recall_winners = 25.0%`
- `avg_profit_approved = 18.38`
- `expectancy_delta = 19.74`

After:

- `accuracy = 74.0%`
- `TP/FP/TN/FN = 6 / 0 / 68 / 26`
- `precision_approved = 100.0%`
- `recall_winners = 18.8%`
- `avg_profit_approved = 26.50`
- `expectancy_delta = 27.86`

Interpretation:

- accuracy stayed flat
- `FP` went to zero
- recall decreased because the ambiguous `INUSDT` pattern also contained `2` winners
- approved trades became much cleaner and more profitable on average

Current conclusion:

- this is a safety-first improvement
- good fit if production should prefer precision over recall
- especially consistent with using `AI_MIN_QUALITY=5` for live order gating

## New export: `1775649989150`

File:

```bash
data/ai/export/ai-dataset-trendline-merged-1775649989150.jsonl
```

Quick context:

- `1495` rows total
- chronological merge is now fixed before replay windowing
- duplicates are much lower than in older exports
- latest windows contain both `LONG` and `SHORT`

## Baseline on new export: `latest 100` before deterministic quality remap

Command:

```bash
yarn ai-train -n 100 --rebuildPrompts -p 3 --model openai/gpt-5-mini --file data/ai/export/ai-dataset-trendline-merged-1775649989150.jsonl
```

Replay result before remap:

- `accuracy = 50.0%`
- `TP/FP/TN/FN = 16 / 31 / 34 / 19`
- `approved = 47`
- `precision_approved = 34.0%`
- `recall_winners = 45.7%`
- `avg_profit_all = 0.38`
- `avg_profit_approved = -0.01`
- `expectancy_delta = -0.39`

Main finding:

- on this more honest window the AI gate had no edge
- approved-trade winrate was slightly worse than the base profitable ratio of the whole window
- `quality` stopped being useful; `quality=5` appeared more often than `quality=4`, but did not mean better trades

## Deterministic quality remap

Implemented in commit:

- `2d19f8c` `Make TrendLine AI quality deterministic`

Implementation summary:

- `TrendLine` adapter now assigns `quality` deterministically in code instead of trusting model confidence
- model still writes analysis text, but `approve/reject` is now mostly driven by deterministic `TrendLine` context
- top-tier `LONG` and `SHORT` setups can still get `q5`
- weaker but still acceptable setups get `q4`
- everything else is forced into `q3` or below and becomes `watch/reject now`

Current ladder shape:

- `LONG q5`: strong breakout, enough displacement, shorter line, strong BTC support
- `LONG q4`: acceptable breakout, moderate displacement, less strict BTC support
- `SHORT q5`: very strong bearish breakout, enough touches, strong BTC support
- `SHORT q4`: acceptable bearish breakout, but not top-tier
- all non-qualifying clean breaks: `q3`

## Replay after deterministic quality remap: `latest 100`

Command:

```bash
yarn ai-train -n 100 --rebuildPrompts -p 3 --model openai/gpt-5-mini --file data/ai/export/ai-dataset-trendline-merged-1775649989150.jsonl
```

Replay result after remap:

- `accuracy = 72.0%`
- `TP/FP/TN/FN = 12 / 5 / 60 / 23`
- `approved = 17`
- `precision_approved = 70.6%`
- `recall_winners = 34.3%`
- `avg_profit_all = 0.38`
- `avg_profit_approved = 16.12`
- `expectancy_delta = 15.74`

By direction:

- `LONG`: `TP/FP/TN/FN = 11 / 4 / 25 / 16`, `precision = 73.3%`
- `SHORT`: `TP/FP/TN/FN = 1 / 1 / 35 / 7`, `precision = 50.0%`

Deterministic flow:

- `core_blocked_now = 0`
- `adapter_blocked_now = 83`
- `left_to_model_now = 17`
- `model_approved = 17`
- `model_rejected = 0`

Interpretation:

- the remap worked in the intended sense: `quality` became useful again
- approvals became much fewer, but far cleaner
- in this window the model stopped being the effective gate; the adapter became the gate

## Replay after deterministic quality remap: `--skip 100 -n 100`

Command:

```bash
yarn ai-train -n 100 --skip 100 --rebuildPrompts -p 3 --model openai/gpt-5-mini --file data/ai/export/ai-dataset-trendline-merged-1775649989150.jsonl
```

Replay result:

- `accuracy = 67.0%`
- `TP/FP/TN/FN = 8 / 11 / 59 / 22`
- `approved = 19`
- `precision_approved = 42.1%`
- `recall_winners = 26.7%`
- `avg_profit_all = -2.28`
- `avg_profit_approved = 2.76`
- `expectancy_delta = 5.04`

By direction:

- `LONG`: `TP/FP/TN/FN = 2 / 4 / 29 / 3`, `precision = 33.3%`
- `SHORT`: `TP/FP/TN/FN = 6 / 7 / 30 / 19`, `precision = 46.2%`

Deterministic flow:

- `core_blocked_now = 0`
- `adapter_blocked_now = 81`
- `left_to_model_now = 19`
- `model_approved = 19`
- `model_rejected = 0`

Interpretation:

- the remap still helps relative to the old fully model-led behavior
- but it generalizes noticeably worse on the previous 100-row window than on the freshest 100-row window
- current deterministic ladder is useful, but not yet robust enough to be treated as a final solution

## Failure analysis on `--skip 100 -n 100`

Error totals:

- `FP = 11`
- `FN = 22`

Breakdown:

- `LONG FP = 4`
- `SHORT FP = 7`
- `LONG FN = 3`
- `SHORT FN = 19`

### `LONG FP`

Main shape:

- moderate `q4` breakouts, not garbage setups
- average `breakVsAtrRatio = 0.662`
- average `abs(priceVsLinePct) = 0.674`
- average `distance = 368`
- average `touches = 5`

Examples:

- `BBUSDT`
- `ICPUSDT`
- `MNTUSDT`
- `AAVEUSDT`

Conclusion:

- this does not look like one cleanly removable false-positive class
- these are moderate `LONG q4` breakouts that still need better separation

### `SHORT FN`

Main shape:

- mostly shallow bearish breaks
- average `breakVsAtrRatio = 0.848`
- average `abs(priceVsLinePct) = 0.816`
- average `btcMaSpreadPct = -0.228`
- average `coinMaSpreadPct = -0.365`
- average `touches = 4.7`

Typical reasons:

- weak BTC follow-through
- weak own-coin follow-through
- too few touches
- explicit bias conflicts

Conclusion:

- current ladder is doing what it was designed to do here
- many `SHORT FN` are weak or conflicted setups, not obvious misses

### `SHORT FP`

Main shape:

- all `7` are strong fresh bearish breakouts
- average `breakVsAtrRatio = 6.132`
- average `abs(priceVsLinePct) = 6.021`
- average `btcMaSpreadPct = -1.415`
- average `coinMaSpreadPct = -1.622`
- average `touches = 5.9`

Examples:

- `FLOCKUSDT`
- `MANAUSDT`
- `NEWTUSDT`
- `NMRUSDT`
- `REDUSDT`
- `SPELLUSDT`
- `USTCUSDT`

Conclusion:

- these do not look like weak entries
- they are much harder to separate from `SHORT TP` using current structural fields alone

## Timing analysis: `SHORT TP` vs `SHORT FP` on `--skip 100 -n 100`

Main result:

- timing does not currently separate the remaining `SHORT FP`

What is identical between `SHORT TP` and `SHORT FP`:

- all are `entryTiming=ready_breakout`
- all have `breakoutFresh=true`
- all have `barsSinceLineCross=0`
- all have `barsSinceClearBreak=0`
- all have `retestHappened=false`
- all have `staleBreakout=false`

Weak differences:

- `SHORT TP` has stronger average line slope and stronger average distance acceleration from the line
- `SHORT FP` is a bit weaker on average on:
  - `lineSlopePctPerBar`
  - `currentDistanceAtrRatio`
  - `distanceAtrVelocity`
  - `distanceAtrAcceleration`

But:

- separation is not clean enough for a safe hard rule
- there are `FP` with very strong acceleration
- there are `TP` with negative velocity

Current conclusion:

- the remaining `SHORT FP` problem is not a stale-breakout problem
- it is not obviously solvable by adding one more simple timing threshold

## New hypothesis: `SHORT TP/SL` may now be the bottleneck

Reasons:

- remaining `SHORT FP` are structurally strong and fresh
- timing state is almost identical to `SHORT TP`
- all `7` `SHORT FP` in this window have the same loss magnitude: `-15.18`
- current `TrendLine` config uses the same symmetric exit profile for both directions:
  - `SHORT TP = 4`
  - `SHORT SL = 1.3`
  - `LONG TP = 4`
  - `LONG SL = 1.3`

Interpretation:

- these trades may not be “bad entries”
- they may be good or acceptable breakouts that still do not survive the current short-side exit profile

Current conclusion:

- next investigation should not start with another quality threshold
- next investigation should be a dedicated `SHORT TP/SL` sweep in strategy config
- this requires new backtests and a fresh `ai-export`, not just replay on old labels
