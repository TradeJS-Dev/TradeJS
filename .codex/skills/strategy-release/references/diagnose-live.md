# Diagnose live behavior

Use this mode to classify observed live behavior of an already released core
plus deterministic gate composition. Do not tune or release a replacement in
the same lineage.

## 1. Bind the exact released composition

Load the immutable release record and verify:

- core config snapshot and fingerprint;
- deterministic gate fingerprint and `MIN_AI_QUALITY`;
- runtime mode, strategy code/git SHA, connector, interval, and ticker scope;
- fees, slippage, entry delay, risk settings, and context-provider settings;
- release acceptance bounds, terminal windows, and forward-incubation cutoff.

Require every scoped runtime evaluation, signal, and trade to carry one clean
logic lineage. Git SHA, core-config fingerprint, gate fingerprint, and context
fingerprint must equal the release manifest. Track `MAX_LOSS_VALUE` separately:
different values are allowed, produce immutable `L` evidence, and require all
monetary observations to be normalized by `runtime / release` risk scale.
Missing/invalid risk scale yields `INSUFFICIENT_EVIDENCE`; missing, dirty,
conflicting, or different logic lineage is `RUNTIME_DIVERGENCE`.

Do not infer live execution from the current local Redis config. Production
signals may run on another server. Request or inspect remote runtime artifacts
when local evidence is not the source of truth.

## 2. Freeze the incident window and evidence

Freeze a half-open incident window `[start, end)`, affected symbols, runtime
trade/signal/evaluation ids, closed-candle timestamps, gate decisions/reasons,
order attempts/fills, fees/funding/slippage, exits, daemon lifecycle, and data
freshness. Hash every input before analysis.

Use only closed candles and signal-time-causal context. Preserve missing skip
evidence as missing; do not treat absent detailed skip records as proof that an
evaluation did not run.

## 3. Establish parity before performance diagnosis

Compare runtime with replay/backtest for the same composition and incident
window:

- effective config and fingerprints;
- candle boundary and restored state/checkpoint;
- candidate signal and deterministic gate decision;
- allocator/risk/order status;
- entry/exit timestamps, prices, reason, fees, funding, and slippage.

Any historical backtest used for context must include `--cacheOnly` and the
maximum common cached window shared by the comparison. Do not update history to
make replay match live.

Classify unmatched items by evidence, not by assumption: no runtime evaluation,
gate/policy block, completed signal without fill match, runtime-only candidate,
backtest-only candidate, price/timestamp mismatch, state/config mismatch, or
context-data mismatch.

## 4. Separate divergence from performance

If a material runtime/replay/config/context mismatch explains the incident,
return `RUNTIME_DIVERGENCE`. Do not judge core generalization from a non-parity
sample.

If parity holds, compare the incident and forward-incubation observations with
the frozen release distribution:

- `ALL`, `LONG`, and `SHORT` N/PnL/PnL-trade/PF/WR/DD/cadence;
- matched release regimes and causal setup cohorts;
- symbol/event concentration and simultaneous batches;
- expected loss streak, losing-period, and drawdown bounds;
- data lag and independent timestamp/event support.

Return `EXPECTED_DRAWDOWN` only when parity is established and the observation
remains within preregistered bounds. Return `GENERALIZATION_FAILURE` only when
parity is established and adequate new post-cutoff evidence breaches the frozen
generalization rule. Otherwise return `INSUFFICIENT_EVIDENCE`.

## 5. Keep comparisons advisory

Do not alter core or gate thresholds in diagnose mode. Record a proposed causal
hypothesis as a new future release lineage.

If `llmComparison=ai-approved`, evaluate only deterministic-gate-approved live
or replay rows with the explicitly configured provider/model. Store agreement,
contradiction, and reasons as advisory evidence. Do not use the LLM to relabel
runtime divergence, override deterministic decisions, or trigger orders.

## Suggested commands

Choose commands supported by the captured evidence and record every flag:

```bash
yarn replay --startTime <start-ms> --endTime <end-ms> --cacheOnly

yarn runtime-parity --startTime <start-ms> --endTime <end-ms> --details

yarn ai-train --strategy <Strategy> --file <released-export-part1.jsonl> \
  --localOnly --json -n 0 --terminalWindows=90,30,7

yarn runtime:scorecard \
  --strategy <Strategy> \
  --runtimeEvidence <verified-runtime-evidence.json> \
  --replayEvidence <replay-runtime-evidence.json> \
  --calibration <execution-calibration.json> \
  --prospectiveEvidence <raw-core-gate-regime-summary.json> \
  --releaseManifest <release-envelope.json> --diagnosisDays <7|30|90> \
  --strategyReleaseRoot data/strategy-release
```

Do not run a broad historical backtest unless it is needed to compare the
incident with the frozen release bounds; when needed, use the exact released
config and maximum common cached window only.

## Diagnostic ready prompt

```text
Use $strategy-release in diagnose-live mode for <Strategy>. Bind release record <path-or-id> to runtime evidence <path-or-id>, freeze incident window <start>..<end>, and check closed-candle/config/state/context/gate/execution parity before performance. Use only --cacheOnly historical comparisons over the maximum common cached window. Set llmComparison=<off|ai-approved>. Return exactly one diagnose verdict and make no runtime or trading changes.
```
