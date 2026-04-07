# TrendLine AI Replay Notes

Last updated: 2026-04-07.

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
