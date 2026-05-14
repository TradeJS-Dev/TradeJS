---
name: runtime-parity-mismatch-analysis
description: Analyze TradeJS runtime parity mismatch JSON files produced by runtime-parity notifications, identify root causes of runtime vs replay/backtest divergences, group them by cause, and point to the exact evidence fields and code paths to inspect next.
---

# Runtime Parity Mismatch Analysis

Use this skill when the user asks to:

- analyze a `runtime-parity-mismatches-*.json` file
- explain why runtime and replay/backtest diverged
- investigate `runtimeOnly` / `backtestOnly` parity cases
- summarize mismatch causes from Telegram parity artifacts
- tell whether a divergence is caused by strategy core, gate/AI/ML, order failure, drift/tolerance, or missing evaluation

This skill is for reading the mismatch JSON artifact first. Do not rerun parity unless the user explicitly asks for a new replay.

## Expected input

Prefer one of these:

- a local `runtime-parity-mismatches-*.json` file
- an attached JSON artifact from Telegram
- raw JSON pasted into the chat

Start with:

- `cases`

Fallback only if needed:

- `mismatches.runtimeOnly`
- `mismatches.backtestOnly`

## Analysis priority

For each case, use this order:

1. `why.classification`
2. `why.reason`
3. `decisionTrace`
4. `timing`
5. `artifacts`

Treat `why.classification` as the primary label, not as a hint.

## Canonical cause mapping

Map each case to one of these buckets:

- `strategy_core`
  - usually `core_skipped`
  - replay/runtime core did not emit a signal
- `gate_ai_ml`
  - usually `gated_out`
  - signal existed but gate / AI / ML / skip logic blocked entry
- `order_placement`
  - usually `order_failed`
  - signal existed but order path failed
- `tolerance_or_drift`
  - usually `backtest_drift`
  - nearest trade exists but is outside allowed timing tolerance
- `missing_evaluation`
  - usually `not_evaluated`
  - no nearby runtime/replay evaluation was produced
- `true_mismatch`
  - usually `true_mismatch`
  - both paths evaluated the setup but still disagree

## What to conclude from each classification

- `core_skipped`
  - First suspect strategy core conditions, candle history, preload window, or config mismatch.
- `gated_out`
  - First inspect `orderSkipReason`, AI/ML thresholds, and runtime-vs-replay gate inputs.
- `order_failed`
  - First inspect order simulation / connector / placement path rather than strategy core.
- `backtest_drift`
  - First inspect timestamp alignment, preload history, tolerance bars, and exchange candle differences.
- `not_evaluated`
  - First inspect target coverage, filtering, persistence, or missing evaluation generation.
- `true_mismatch`
  - First inspect direction, statuses, and signal/evaluation artifacts on both sides.

## TradeJS-specific inspection paths

If the JSON alone is not enough, inspect these code areas:

- mismatch builder and classifications:
  - `packages/cli/src/scripts/runtimeParity.ts`
- parity entry extraction and matching:
  - `packages/cli/src/lib/runtimeParity.ts`
- runtime signal persistence/loading:
  - `packages/cli/src/lib/runtimeSignalsLoader.ts`
- strategy runtime and signal/evaluation flow:
  - `packages/node/src/testing.ts`
  - `packages/node/src/strategyHelpers/runtime.ts`
  - `packages/node/src/signals.ts`
- strategy implementation:
  - `packages/strategies/**/core.ts`
  - `packages/strategies/**/adapters/ai.ts`

When a case says `core_skipped`, inspect the strategy `core.ts` before blaming Telegram, Redis, or the connector.

## Output format

For each case, provide:

1. `Case`
   - strategy / symbol / direction / signalId
2. `Root cause`
   - one short sentence
3. `Evidence`
   - cite the exact JSON fields that support the conclusion
4. `Bucket`
   - one of the canonical cause buckets above
5. `Next checks`
   - 1-3 concrete checks in code or config

If there are many cases, group them by:

- `why.classification`
- then by strategy

If all cases share one cause, say that explicitly before listing details.

## What not to do

- Do not default to generic “timing issue” wording if `why.classification` already says `gated_out` or `core_skipped`.
- Do not treat `recommendedChecks` as proof; use them only as follow-up guidance.
- Do not ignore `decisionTrace` when `orderStatus` or `orderSkipReason` is present.
- Do not rerun backtests or parity automatically.

## Example prompt

Use this prompt shape when the user gives you a mismatch artifact:

```text
Analyze this runtime parity mismatch JSON.
For each case:
1. Name the root cause.
2. Cite the exact fields that prove it.
3. Classify it as strategy_core, gate_ai_ml, order_placement, tolerance_or_drift, missing_evaluation, or true_mismatch.
4. Give the next 1-3 checks in the TradeJS codebase.
If several cases share one cause, group them.
```
