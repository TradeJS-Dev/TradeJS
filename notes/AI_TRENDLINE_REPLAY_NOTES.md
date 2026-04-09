# TrendLine AI Replay Notes

Last updated: 2026-04-09.

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

## Runtime default model

Implemented in commit:

- `c90ba0f` `Default AI runtime to GPT-5 mini`

Current default:

- `askAI` and `ai-train` now default to `openai/gpt-5-mini`
- another model should be used only when explicitly passed through `--model`

## New export: `1775667786011`

File:

```bash
data/ai/export/ai-dataset-trendline-merged-1775667786011.jsonl
```

## Replay on new export: `latest 200` before quality ladder recalibration

Command:

```bash
yarn ai-train -n 200 -p 8 --file data/ai/export/ai-dataset-trendline-merged-1775667786011.jsonl
```

Replay result:

- `accuracy = 72.0%`
- `TP/FP/TN/FN = 10 / 27 / 134 / 29`
- `approved = 37`
- `precision_approved = 27.0%`
- `recall_winners = 25.6%`
- `avg_profit_all = -0.54`
- `avg_profit_approved = 1.52`
- `expectancy_delta = 2.06`

By direction:

- `LONG`: `TP/FP/TN/FN = 7 / 15 / 59 / 13`, `precision = 31.8%`, `recall = 35.0%`
- `SHORT`: `TP/FP/TN/FN = 3 / 12 / 75 / 16`, `precision = 20.0%`, `recall = 15.8%`

Deterministic flow:

- `adapter_blocked_now = 163`
- `left_to_model_now = 37`
- `model_approved = 37`
- `model_rejected = 0`

Main finding:

- current deterministic gate still left too many moderate `LONG` approvals and overextended `SHORT` approvals
- `quality=5` was still inflated and not materially better than `quality=4`
- at this point the bottleneck was again not the model, but the deterministic ladder

## Failure analysis on `latest 200`

False-positive split:

- `LONG FP = 15`
- `SHORT FP = 12`

Observed shapes:

- `LONG FP`: mostly moderate clean breakouts, average `breakVsAtrRatio ~ 0.72`, average `distance ~ 314`
- `SHORT FP`: mostly very strong bearish breakouts that looked late/overextended, average `breakVsAtrRatio ~ 5.22`, average `distance ~ 555`

Practical takeaway:

- `LONG q5` needed a stricter top-tier definition
- `SHORT q5` needed an explicit overextension downgrade

## Guardrail change: deterministic quality ladder recalibration

Implemented in commit:

- `54c5e20` `Tighten TrendLine deterministic quality ladder`

Implementation summary:

- tightened `LONG q5`
- split `LONG q4` into a smaller set of acceptable breakout shapes
- tightened `SHORT q5` to exclude very stretched bearish breaks
- kept `SHORT q4` only for moderate clean breaks
- downgraded overextended `SHORT` setups from approval into `q3`

## Replay after ladder recalibration: `latest 200`

Command:

```bash
yarn ai-train -n 200 -p 8 --file data/ai/export/ai-dataset-trendline-merged-1775667786011.jsonl
```

Replay result:

- `accuracy = 83.5%`
- `TP/FP/TN/FN = 9 / 3 / 158 / 30`
- `approved = 12`
- `precision_approved = 75.0%`
- `recall_winners = 23.1%`
- `avg_profit_all = -0.54`
- `avg_profit_approved = 16.73`
- `expectancy_delta = 17.26`

By direction:

- `LONG`: `TP/FP/TN/FN = 6 / 2 / 72 / 14`, `precision = 75.0%`
- `SHORT`: `TP/FP/TN/FN = 3 / 1 / 86 / 16`, `precision = 75.0%`

Deterministic flow:

- `adapter_blocked_now = 188`
- `left_to_model_now = 12`
- `model_approved = 12`
- `model_rejected = 0`

Interpretation:

- this was a large precision improvement without any meaningful help from the model itself
- the system now behaves much closer to `deterministic policy engine + AI explanation`
- `accuracy` here measures the full approve/reject pipeline, not standalone LLM quality

## Dynamic setup-based risk model

Implemented after the replay work:

- dynamic `SL` in `TrendLine core`
- `TP` now derived from `SL * targetRR`
- separate `LONG` and `SHORT` behavior, but only through shared setup features

Implementation summary:

- `SL` is now derived from:
  - line invalidation distance
  - ATR buffer
  - breakout strength
  - touches
  - line distance
  - timing state (`ready_breakout`, `ready_follow_through`, `ready_retest`)
- `TP` is now derived from a setup-based target `RR`, not from a fixed percent
- break-even protection now uses actual position risk when a live `SL` is known

## Validation after dynamic risk model: `latest 200`

Export:

```bash
data/ai/export/ai-dataset-trendline-merged-1775678280125.jsonl
```

Replay-equivalent result on `latest 200`:

- `accuracy = 74.5%`
- `TP/FP/TN/FN = 9 / 3 / 140 / 48`
- `approved = 12`
- `precision_approved = 75.0%`
- `recall_winners = 15.8%`
- `avg_profit_all = 1.58`
- `avg_profit_approved = 16.15`
- `expectancy_delta = 14.57`

By direction:

- `LONG`: `TP/FP/TN/FN = 6 / 2 / 65 / 22`
- `SHORT`: `TP/FP/TN/FN = 3 / 1 / 75 / 26`

Interpretation:

- dynamic risk did not break the safety profile
- but it did not improve approval recall on its own
- the main bottleneck remained the deterministic `q3 -> q4` boundary in the TrendLine AI adapter

## Follow-up experiment: restore a narrow `SHORT ready_breakout` approval path

Problem observed after dynamic risk validation:

- too many profitable `SHORT ready_breakout` setups were still capped at `q3`
- this showed up as a large `SHORT FN` cluster on the latest `200` rows

Initial combined experiment:

- re-approve strong `SHORT ready_breakout`
- also relax `LONG ready_follow_through` and `LONG ready_retest`

Combined replay result:

- `accuracy = 74.0%`
- `TP/FP/TN/FN = 18 / 13 / 130 / 39`
- `approved = 31`
- `precision_approved = 58.1%`
- `recall_winners = 31.6%`

Conclusion:

- the `SHORT` relaxation helped recall
- but the additional `LONG` relaxation introduced too many new `FP`
- this combined variant should not be kept

## Current best working variant after the latest comparison

Kept change:

- restore only a narrow `SHORT ready_breakout q3 -> q4` path

Rolled back from the experiment:

- `LONG ready_follow_through q3 -> q4`
- `LONG ready_retest q3 -> q4`

Replay-equivalent result on the same `latest 200` window:

- `accuracy = 76.0%`
- `TP/FP/TN/FN = 15 / 6 / 137 / 42`
- `approved = 21`
- `precision_approved = 71.4%`
- `recall_winners = 26.3%`
- `avg_profit_all = 1.58`
- `avg_profit_approved = 16.62`
- `expectancy_delta = 15.04`

By direction:

- `LONG`: `TP/FP/TN/FN = 6 / 2 / 65 / 22`
- `SHORT`: `TP/FP/TN/FN = 9 / 4 / 72 / 20`

Quality breakdown:

- `quality=4`: `19` approvals, `68.4%` winrate, `avg_profit = 15.36`
- `quality=5`: `2` approvals, `100.0%` winrate, `avg_profit = 28.60`

Current conclusion:

- this is a better tradeoff than the plain post-risk baseline
- it preserves the safer `LONG` side while materially improving `SHORT` recall
- it is also materially better than the combined `LONG + SHORT` relaxation

## Rollback guidance

If a rollback is needed, use these levels:

- best proven pure AI-gate checkpoint before the dynamic-risk branch: `54c5e20`
- best current repo baseline to keep: `73308b6`

Practical recommendation:

- do not roll back below `73308b6`
- if continuing from current work, keep the repo on top of `73308b6`
- apply only the narrow `SHORT ready_breakout` approval restoration, not the broader `LONG` relaxations

## New export after fresh backtest: `1775714508559`

File:

```bash
data/ai/export/ai-dataset-trendline-merged-1775714508559.jsonl
```

Important note:

- full remote `ai-train` via OpenRouter became unreliable on this export due to provider-side waiting / throttling
- for current `TrendLine` this does not materially change approve/reject analysis, because the effective gate is deterministic in the adapter and the model does not reject allowed rows
- below, `latest 200` and `latest 500` were computed via a replay-equivalent local pass over the same dataset and current `TrendLine` AI adapter

## Replay-equivalent result on new export: `latest 200`

Window:

```bash
latest 200 rows from data/ai/export/ai-dataset-trendline-merged-1775714508559.jsonl
```

Replay-equivalent result:

- `accuracy = 64.5%`
- `TP/FP/TN/FN = 14 / 5 / 115 / 66`
- `approved = 19`
- `precision_approved = 73.7%`
- `recall_winners = 17.5%`
- `avg_profit_all = 2.11`
- `avg_profit_approved = 13.04`
- `expectancy_delta = 10.93`

By direction:

- `LONG`: `TP/FP/TN/FN = 7 / 1 / 58 / 30`, `approved = 8`, `precision = 87.5%`
- `SHORT`: `TP/FP/TN/FN = 7 / 4 / 57 / 36`, `approved = 11`, `precision = 63.6%`

Quality breakdown:

- `quality=4`: `18` approvals, `72.2%` winrate
- `quality=5`: `1` approval, `100.0%` winrate
- `quality=3`: `181` rejects, winner-rate `36.5%`

Deterministic flow:

- `core_blocked_now = 0`
- `adapter_blocked_now = 181`
- `left_to_model_now = 19`
- `model_approved = 19`
- `model_rejected = 0`

Interpretation:

- precision stayed healthy, but recall dropped hard relative to the older `latest 200`
- this new window is much more profitable overall, and the current deterministic ladder misses too many winners
- the bottleneck is still the adapter-level `q3 -> q4` boundary, not the LLM

## Replay-equivalent result on new export: `latest 500`

Window:

```bash
latest 500 rows from data/ai/export/ai-dataset-trendline-merged-1775714508559.jsonl
```

Replay-equivalent result:

- `accuracy = 68.4%`
- `TP/FP/TN/FN = 21 / 19 / 321 / 139`
- `approved = 40`
- `precision_approved = 52.5%`
- `recall_winners = 13.1%`
- `avg_profit_all = 0.15`
- `avg_profit_approved = 8.26`
- `expectancy_delta = 8.11`

By direction:

- `LONG`: `TP/FP/TN/FN = 9 / 7 / 156 / 64`, `precision = 56.3%`, `recall = 12.3%`
- `SHORT`: `TP/FP/TN/FN = 12 / 12 / 165 / 75`, `precision = 50.0%`, `recall = 13.8%`

Quality breakdown:

- `quality=4`: `37` approvals, `48.6%` winrate, `avg_profit = 6.94`
- `quality=5`: `3` approvals, `100.0%` winrate, `avg_profit = 24.51`
- `quality=3`: `460` rejects, winner-rate `30.2%`

Deterministic flow:

- `core_blocked_now = 0`
- `adapter_blocked_now = 460`
- `left_to_model_now = 40`
- `model_approved = 40`
- `model_rejected = 0`

Interpretation:

- edge still exists, but it is now conservative and weaker than on shorter windows
- approved trades are better than the base window winrate, but a very large number of winners are still rejected
- the current ladder is stable enough to avoid chaos, but not yet strong enough on recall

## Timing visibility fix in TrendLine AI adapter

Problem found:

- `TrendLine core` already wrote `trendlineTiming` into the signal
- `TrendLine` AI adapter used `entryTiming` internally for deterministic quality
- but `entryTiming` was not returned in `trendlineContext`, so prompt context and replay diagnostics were blind to timing stage

Fix:

- `entryTiming` is now returned in `trendlineContext`
- it is also rendered in the human prompt for visibility

Effect:

- replay metrics did not change
- diagnostics became timing-aware again

## Timing breakdown on `latest 500`

With `entryTiming` visible in replay context:

`FN = 139`:

- `ready_retest = 65`
- `ready_follow_through = 64`
- `ready_breakout = 10`

`FP = 19`:

- `ready_breakout = 10`
- `ready_follow_through = 5`
- `ready_retest = 4`

`TP = 21`:

- `ready_breakout = 12`
- `ready_follow_through = 5`
- `ready_retest = 4`

Main finding:

- the largest recall gap is no longer in `ready_breakout`
- most missed winners now sit in `ready_retest` and `ready_follow_through`
- but broad relaxation is unsafe, because already-approved `follow_through` and `retest` setups are nearly coin-flip on this window

## `latest 500` false-negative analysis

Totals:

- `FN = 139`
- `LONG FN = 64`
- `SHORT FN = 75`

Hard-block split:

- `none = 67`
- `btc_bias_conflict = 33`
- `coin_bias_conflict + btc_bias_conflict = 21`
- `coin_bias_conflict = 13`
- `weak_btc_led_break = 5`

Average profile:

- `breakVsAtrRatio ≈ 0.694`
- `priceVsLinePctAbs ≈ 0.690`
- `touches ≈ 5.17`
- `distance ≈ 385`

Main finding:

- a large share of `FN` are not structural rejects
- they are moderate clean breaks that still remain at `q3`
- the adapter is stricter than needed on many acceptable-but-not-top-tier setups

Timing-specific no-hard-block concentration:

- `LONG | ready_retest = 24`
- `SHORT | ready_follow_through = 18`

Practical takeaway:

- the next useful discriminators should target these two clusters, not all clean breaks globally

## `latest 500` false-positive analysis

Totals:

- `FP = 19`
- all `FP` are `quality=4`
- all `FP` are `clearBreak=true` and `nearLineNoise=false`
- all `FP` have no hard-block reason

Average profile:

- `breakVsAtrRatio ≈ 3.893`
- `priceVsLinePctAbs ≈ 3.514`
- `touches ≈ 5.74`
- `distance ≈ 344.68`

Main finding:

- current `FP` are not weak/noisy entries
- they look like strong, often stretched breakouts
- especially on the `SHORT` side, current `TP` and `FP` shapes are very similar, which suggests that pure threshold tuning may be near its limit

Practical takeaway:

- further progress likely needs either:
  - better timing-stage subfeatures
  - candle-shape / wick / close-location features
  - or additional work on `SHORT` exit profile rather than only entry approval

## Operational note: OpenRouter / Azure content-policy failures

Observed production issue:

- OpenRouter occasionally routed AI requests to Azure
- Azure returned `403` with a content-policy / temporary-block message on internal trading-classification prompts

Fix implemented in commit:

- `993a5c5` `Harden OpenRouter routing and trim signal output`

Implementation summary:

- when `OPENAI_API_ENDPOINT` points to OpenRouter, AI calls now send:
  - `provider: { ignore: ['azure'] }`
- this is applied in both:
  - runtime AI helper
  - app chat route

Additional cleanup in the same commit:

- removed verbose internal lines from Telegram signal messages:
  - `Points`
  - `ATR`
  - `Distance`
  - `BTC spread (CB-BN)/BN`
- removed the old `react-hooks/exhaustive-deps` warning in `apps/app/src/app/store/data.ts`

Current conclusion:

- routing around Azure is the correct first operational fix because the failure was explicitly provider-specific
- this does not prove that prompt text is perfect, but it removes the currently observed upstream failure mode
