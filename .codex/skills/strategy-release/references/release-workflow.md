# Release workflow

Use this workflow to evaluate one frozen core plus deterministic AI-gate
composition. Do not use it to promote the composition.

## 1. Freeze the release question

Create an immutable experiment id and preregister:

- strategy and current control composition;
- exact release acceptance rule and current-market terminal windows;
- three causally distinct core hypothesis families;
- exactly five variants in each family, with resolved configs and one stated
  mechanism per variant;
- candidate ranking and tie-break rules;
- non-target-side invariance or occupancy-spillover rule;
- the one allowed deterministic gate tuning round;
- `llmComparison: off | ai-approved`;
- required evidence and terminal conditions.

Treat the common control as a separate frozen reference. The research budget is
15 core variants total, not a rolling invitation to add nearby thresholds after
seeing results. Record every attempted, failed, rejected, and retained cell in
the same trial ledger.

## 2. Freeze cached historical coverage

Resolve the intersection of cached candle and required causal context coverage
for the complete ordered ticker universe. Freeze the maximum common half-open
window `[start, end)` and its proof. Use that same window, universe, connector,
interval, fees, slippage, entry delay, and context settings for every historical
control and candidate comparison.

Every historical backtest command must include:

```text
--startTime <frozen-start> --endTime <frozen-end> -t <frozen-ordered-tickers> --cacheOnly
```

Use `--fast --ai` only as raw completed-core-trade transport when appropriate;
state that BACKTEST does not apply the AI quality gate. Never refresh data,
change membership, or fall back to a shorter available subset. If the common
window is inadequate, return `INSUFFICIENT_EVIDENCE`.

## 3. Capture the control

Run the frozen control as a complete, run-scoped experiment. Export only after
the manifest finishes and keep chunks. Reconcile Redis N/W/L/PnL against
completed-trade rows. Report full-window and preregistered terminal metrics for
`ALL`, `LONG`, and `SHORT`, including zero-trade cohorts.

Do not disable a weak side. Record separate control statuses for ALL, LONG, and
SHORT so the later deterministic AI gate can evaluate side cohorts explicitly.

## 4. Screen the bounded core families

Evaluate all 15 preregistered variants on the frozen common window. Preserve
each `configId`; never combine cells into one result. Use isolated cells when
the strategy's state identity does not prove grid isolation.

For each family:

1. Compare every variant with the same control.
2. Match trade/setup identities where stable identity exists.
3. Report matched, control-only, candidate-only, changed-outcome, and occupancy
   spillover cohorts.
4. Attribute deltas only to causal signal-time regime/context fields frozen in
   the preregistration.
5. Apply the preregistered target-side and aggregate guardrails.

When a direction-targeted policy is architecturally isolated, require exact
non-target identities/N and PnL equality within documented rounding. When
position occupancy, cooldown, or order lifecycle can affect the opposite side,
measure added/removed identities and require the preregistered non-regression
rule instead.

## 5. Select one isolated-long finalist

Select at most one core finalist across all families using only the frozen rule.
If none qualifies, do not invent a compromise candidate. Rerun the selected
cell alone over the same maximum common cached window and frozen universe. This
is the only isolated-long finalist run allowed in the lineage.

Require complete run/export reconciliation and agreement with the screened
cell within the preregistered reset/grid tolerance. Investigate any difference
as state/reset contamination; do not choose the more favorable run.

## 6. Use one gate tuning round

Freeze the isolated finalist's raw-core export and the current deterministic
gate as control. Use one time-grouped, time-ordered train/tuning/test design.
Audit existing gate rules, run pocket discovery/ablation without outcome or
execution leakage, and preregister rounded thresholds before opening the test.

Select one deterministic gate candidate, or retain the frozen current gate if
no candidate passes. Do not perform a second search after viewing the held-out
test. The release unit is then exactly one core snapshot plus one deterministic
gate fingerprint.

If `llmComparison=ai-approved`, compare LLM output only on rows approved by the
final deterministic gate. Record provider/model/prompt lineage and cost. Treat
the comparison as advisory; never use it to tune, approve, reject, or promote
the composition.

## 7. Confirm robustness and issue the verdict

Report the final composition on the frozen full window and required terminal
windows, plus standalone cold-start/reset checks when the strategy is stateful.
Keep continuous-run terminal slices distinct from standalone horizons.

Apply [verdict-contract.md](verdict-contract.md). Write the immutable evidence
bundle before returning the verdict. `READY_FOR_RUNTIME` authorizes only a
separate user review; it does not authorize config writes, risk changes,
deployment, daemon changes, or orders.

Before creating the release manifest, generate the finalist monitoring profile
from its normalized `trades.jsonl`. Freeze daily-stepped equal-length historical
drawdown envelopes for the prospective diagnostic horizons, the minimum closed-
trade sample, minimum runtime parity ratio, maximum order-failure rate, raw-core
expectancy, gate expectancy, and overfit estimate. Do not calculate these bounds
from the later live sample. Also freeze the minimum causal-regime coverage needed
to attribute a breached envelope.

Reference core, gate, runtime-parity, and execution-calibration artifacts in a
release draft with their expected SHA-256 checksums. `strategy:release create`
reads, hashes, validates, and derives release gate assertions from the files
itself; draft `verified` and gate booleans are never trusted as authority.
Reconciled final core evidence, complete robustness, positive deterministic-gate
terminal evidence, exact parity, and measured execution residual are mandatory
for `READY_FOR_RUNTIME`.
Incomplete evidence must produce `INSUFFICIENT_EVIDENCE`, even when the partial
economics look unsuitable.

## Command shapes

Use exact project commands and record the resolved versions:

```bash
yarn backtest -c <Config> --ai --startTime <start-ms> --endTime <end-ms> \
  -t "$FROZEN_TICKERS" --cacheOnly --fast -p <safe-parallelism> -g 1000

yarn ai-export --strategy <Strategy> --runId <completed-run-id> --keepChunks

yarn node -r dotenv/config \
  .codex/skills/strategy-backtest-research/scripts/fast-ai-export-metrics.mjs \
  --file <merged-export.jsonl> --run <completed-run-id> --json

yarn ai-train --strategy <Strategy> --file <merged-export-part1.jsonl> \
  --localOnly --json -n 0 --terminalWindows=365,180,90,30,7

yarn ai-pocket-search --strategy <Strategy> \
  --file <merged-export-part1.jsonl> -n 0 --validationSplit 0.2 \
  --testSplit 0.2 --maxDepth 2 --minSupport 25

yarn strategy:release profile --input <trades.jsonl> --variant <finalist-id> \
  --startTime <start-ms> --endTime <end-ms> --days 7,30,90 \
  --out <monitoring-profile.json>

yarn strategy:release create --input <release-draft.json> \
  --root data/strategy-release

yarn strategy:release verify \
  --input data/strategy-release/releases/<Strategy>/<release-id>.json
```

Use `ai-gate-ablation.mjs` for the fixed gate candidate and its held-out
comparison. Do not use temporary parsers when permanent research tooling covers
the analysis.
