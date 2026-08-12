# Release workflow

Use this workflow to evaluate one frozen core plus deterministic AI-gate
composition. Do not use it to promote the composition.

## Environment boundary

Historical research, exports, and local Redis configs live on the research
machine. Production accounts, credentials, deployments, signals, and trades
live on the runtime server. Missing local runtime keys are not evidence that
their production counterparts do not exist. Never copy credentials into
research evidence.

The local output is a portable composition handoff. Match committed source plus
canonical core-config, gate, runtime-logic, and context fingerprints across
machines. `configId`, `ACCOUNT_ID`, `DEPLOYMENT_ID`, and
`MAX_LOSS_VALUE` are operational binding/risk fields: preserve them separately,
but do not let differences create a false logic mismatch. API credentials are
server secrets: never export, hash, or compare them as research identity.
`ENABLE`, `AI_ENABLED`,
`AI_MODE`, `MIN_AI_QUALITY`, detector/side policy, interval/universe, fees, and
execution/context semantics remain parity-critical.

Do not create a new release manifest when only runtime `MAX_LOSS_VALUE`
changes. Preserve the deployed release's existing `compositionId`, record the
new scale as a separate `L` marker, and normalize monetary runtime evidence
back to the release risk unit; do not reset the composition's logic history.

## 1. Freeze the release question

Create an immutable experiment id and preregister:

- strategy and current control composition;
- exact release acceptance rule and current-market terminal windows;
- three causally distinct core hypothesis families;
- the three-round allocation for every family: one anchor candidate in round 1,
  two child candidates in round 2, and two child candidates in round 3;
- the round-1 resolved configs plus the rule that turns prior metric, matching,
  and trace evidence into the two next-round variants;
- candidate ranking and tie-break rules;
- non-target-side invariance or occupancy-spillover rule;
- the one allowed deterministic gate tuning round;
- `llmComparison: off | ai-approved`;
- required evidence and terminal conditions.

Treat the common control as a separate frozen reference. The research budget is
five candidate variants per family and 15 total at most. Exact round-2 and
round-3 configs are intentionally not guessed before their parent evidence
exists, but each must be preregistered in a new immutable child spec before its
run. The allocation is not a rolling invitation to add nearby thresholds after
seeing results. Record every attempted, failed, rejected, and retained cell in
the same trial ledger.

## 2. Freeze cached historical coverage

Resolve the intersection of cached candle and required causal context coverage
for the complete ordered ticker universe. Freeze the maximum common half-open
window `[start, end)` and its proof. Use that same window, universe, connector,
interval, fees, slippage, entry delay, and context settings for every historical
control and candidate comparison.

Inside that maximum cached envelope, freeze a timestamp-grouped chronological
core release tail before round 1. Core improvement rounds may use only the
development/tuning interval ending before that tail. Commands must not print,
rank, or otherwise expose tail economics. After round 3 freezes the finalist,
the isolated-long/final comparison opens the tail exactly once and evaluates
the complete maximum cached window. This preserves an untouched test while
still using every available candle in the terminal release matrix.

Every historical backtest command must include:

```text
--startTime <frozen-start> --endTime <frozen-end> -t <frozen-ordered-tickers> --cacheOnly
```

Use `--fast --ai` only as raw completed-core-trade transport when appropriate;
state that BACKTEST does not apply the AI quality gate. Never refresh data,
change membership, or fall back to a shorter available subset. If the common
window is inadequate, return `INSUFFICIENT_EVIDENCE`.

For the final composition, the full-statistics matrix is mandatory:

- trailing 1095 days (3y);
- trailing 1460 days (4y);
- trailing 1825 days (5y), or the exact maximum available cached coverage when
  it is shorter; record both requested and covered days;
- 365d, 180d, 90d, 30d, and 7d terminal slices.

Each row contains ALL/LONG/SHORT N, PnL, PnL/trade, PF, WR, realized MaxDD,
and cadence. Use the permanent metrics tooling from
`$strategy-backtest-research`; do not reconstruct a favorable subset manually.

## 3. Capture the control

Run the frozen control as a complete, run-scoped experiment. Export only after
the manifest finishes and keep chunks. Reconcile Redis N/W/L/PnL against
completed-trade rows. Report full-window and preregistered terminal metrics for
`ALL`, `LONG`, and `SHORT`, including zero-trade cohorts.

Do not disable a weak side. Record separate control statuses for ALL, LONG, and
SHORT so the later deterministic AI gate can evaluate side cohorts explicitly.

## 4. Run and analyze three causal core rounds

Run every release-core candidate with `--researchTrace`. The compact trace is
required here because each later round must be derived from observed
setup/entry/skip transitions, not from a PnL leaderboard. Preserve each
`configId`; never combine cells into one result. Use isolated cells when the
strategy's state identity does not prove grid isolation.

Use one immutable `stage=screen` research lineage per family and round:

1. **Round 1 — mechanism anchors.** Compare the original frozen control with
   one distinct anchor candidate for each of the three causal families.
2. **Round 2 — evidence-driven alternatives.** For every still-viable family,
   carry its round-1 winner as the exact matched control and freeze two child
   candidates: one intervention addressing the primary diagnosed failure and
   one alternative/ablation that can falsify the explanation.
3. **Round 3 — refinement plus robustness.** Carry the round-2 winner as the
   exact control and freeze two new child candidates from the combined prior
   evidence: one refinement of the supported mechanism and one robustness
   variant targeting its remaining side/regime/cost/occupancy weakness.

Every round-2/round-3 screen spec must use a new `researchId`, name its direct
`parentResearchIds` both at the spec root and in lineage, keep the same
hypothesis family, and state the exact parent metric/trace observation that
motivates each config delta. Run `prepare`, regenerate `research:core index`
before execution to validate the parent/family chain, then `run`, `verify`, and
regenerate the index after completion.

After **each** round, complete this analysis before writing a child spec:

1. Verify manifest/checkpoint completeness, run-scoped export hashes,
   reconciliation, duplicate/conflict counts, and trace coverage.
2. Report fixed ALL/LONG/SHORT N, PnL, PnL/trade, PF, WR, realized MaxDD, and
   cadence for the round window, terminal development slices, folds, and
   months; include payoff/tail, holding time, loss streak, and equity/DD curves.
3. Match stable setup/trade identities and report matched, control-only,
   candidate-only, changed-outcome, and occupancy-spillover cohorts by side.
4. Compare the compact trace funnel across signal emission or entry rejection,
   execution, exit, and per-test skip summaries; use deterministic setup
   identities from completed rows for pre-entry matching. Attribute top skip
   deltas and verify the candidate changed the intended transition rather than
   an unrelated lifecycle.
5. Break deltas down by causal signal-time regime, symbol/concentration,
   direction, time fold, and cost stress. Review calendar-cluster bootstrap,
   family-aware Holm, DSR/PBO, and no-op/reset contamination warnings.
6. Write a causal mechanism verdict — `supported`, `falsified`, or
   `inconclusive` — plus the predicted versus observed trace/metric effect and
   the exact reason each family continues or retires.

Persist that conclusion as the round's immutable causal handoff. At minimum it
contains this machine-readable payload alongside the normal research note:

```json
{
  "round": 1,
  "researchId": "<immutable id>",
  "parentResearchIds": [],
  "controlVariantId": "<id>",
  "candidateVariantIds": ["<id>"],
  "resultSha256": "<sha256>",
  "traceCoverage": "complete",
  "mechanismVerdict": "supported|falsified|inconclusive",
  "predictedEffect": "<frozen before run>",
  "observedEffect": "<metrics + identities + trace transition>",
  "failureMode": "<remaining causal weakness or null>",
  "familyDecision": "continue|retire",
  "nextVariants": [
    {
      "role": "primary_fix|falsification|refinement|robustness",
      "configDelta": {},
      "causalClaim": "<why this follows from the parent>",
      "predictedTraceEffect": "<event/skip conversion>",
      "predictedMetricEffect": "<target and guardrails>"
    }
  ]
}
```

Round 1 uses one candidate per family and therefore records two frozen
`nextVariants` when the family continues. Round 2 also records two. Round 3
records no further core candidates; it records only `select_for_isolated_long`
or `retire`. Hash the payload and cite it in the child research note/spec
lineage so another Codex run can reconstruct why the child exists without
reading an informal narrative.

Do not derive a child from displayed losers, outcome fields, or the sealed core
release tail. Do not create “best value ± epsilon” variants without a causal
transition hypothesis. Complete rounds 2 and 3 for every still-viable family
even when an earlier candidate is already profitable. A family may retire
early only when immutable evidence is invalid, the intervention is a no-op,
the mechanism is falsified, required point-in-time context is unavailable, or
no causal signal remains to test. If all families retire, stop rather than
manufacturing variants.

The carried control is the best **eligible** parent under the frozen rule. A
failed candidate is never relabelled a winner: if its trace supports another
causal test but its economics fail, retain the preceding control and record the
failed candidate only as diagnostic parent evidence for the two child variants.

When a direction-targeted policy is architecturally isolated, require exact
non-target identities/N and PnL equality within documented rounding. When
position occupancy, cooldown, or order lifecycle can affect the opposite side,
measure added/removed identities and require the preregistered non-regression
rule instead.

## 5. Select one isolated-long finalist

After round 3, select at most one core finalist across all families using only
the frozen rule and cumulative family ledger. If none qualifies, do not invent
a compromise candidate. Rerun the selected cell alone over the complete maximum
common cached window and frozen universe, opening the chronological core release
tail for the first and only time. This is the only isolated-long finalist run
allowed in the lineage.

Require complete run/export reconciliation and agreement with the screened
cell within the preregistered reset/grid tolerance. Investigate any difference
as state/reset contamination; do not choose the more favorable run.

The isolated-long result may confirm or reject the frozen finalist. It may not
generate a fourth core-improvement round. Any new hypothesis after the tail is
opened starts a new release lineage with a future unexposed tail.

## 6. Use one gate tuning round

Freeze the isolated finalist's raw-core export and the current deterministic
gate as control. Use one time-grouped, time-ordered train/tuning/test design.
Audit existing gate rules, run pocket discovery/ablation without outcome or
execution leakage, and preregister rounded thresholds before opening the test.
`ai-pocket-search` must reserve the test with `--sealTest`; its discovery report
may contain only sealed test counts/bounds, never test economics. Store the
complete five-variant spec before the fixed ablation opens that tail once.

Select one deterministic gate candidate, or retain the frozen current gate if
no candidate passes. Do not perform a second search after viewing the held-out
test. The release unit is then exactly one core snapshot plus one deterministic
gate fingerprint.

### Mandatory side-rescue checkpoint

Before freezing the five gate variants, build this coverage table for raw core
and current qN+ approvals in every full/terminal window:

```text
ALL/LONG/SHORT: raw N, PnL, PnL/trade, PF, WR, MaxDD, cadence
ALL/LONG/SHORT: gate-approved N, approval share, same economics
```

A side requires rescue analysis when its raw cohort is positive or passes the
preregistered side edge rule while the current gate approves zero/negligible
support, or when removing that side materially destroys aggregate edge. Do not
call the strategy unsuitable merely because the current gate discarded such a
side.

Freeze exactly five gate variants before looking at tuning/test outcomes:

1. current deterministic gate control;
2. current gate plus raw pass-through for the target side;
3. current gate plus one rounded causal target-side pocket found on train only;
4. current gate plus the target-side pocket and one preregistered protective
   exclusion;
5. direction-aware replacement: best preregistered policy per side, including
   raw pass-through where it is the frozen candidate.

Use the permanent direction-aware ablation syntax rather than a proxy feature:

```text
short-pass-through::add@4[SHORT]::true
short-pocket::add@4[SHORT]::<rounded causal expression>
direction-aware::replace@4::(derived.direction == LONG && <long rule>) || (derived.direction == SHORT && <short rule>)
```

Run pocket discovery separately for `LONG` and `SHORT`. Select variants using
train and tuning only, then open the one chronological test tail once. Require:

- no outcome/execution leakage;
- minimum independent events and cadence in the target side;
- target-side PnL and PnL/trade improvement with PF/WR/MaxDD guardrails;
- explicit aggregate portfolio guardrails;
- explicit non-target identity or occupancy-spillover comparison;
- full/180d/90d/30d/7d tables, retaining zero rows.

If the sealed test was opened during discovery, intentionally or by an older
tool version, it is exposed forever for that lineage. Finish and record the
fixed comparison as diagnostic evidence, but do not retune on it, relabel it as
untouched, or use it to justify `READY_FOR_RUNTIME`. The candidate may enter a
new post-cutoff forward incubation lineage.

### One bounded recent-direction repair

After the one gate round, a failing 30d/7d direction may receive exactly one
repair round only when all are true:

- the failed window has at least 20 independent target-side closed trades;
- a causal signal-time mechanism was preregistered from train/tuning and regime
  diagnostics, not inferred by filtering the displayed losers;
- the evaluation tail was not exposed;
- no earlier terminal repair round was used.

Freeze five repair variants and preserve non-target/aggregate guardrails. When
support is below 20, the tail is exposed, or the mechanism is unknown, do not
fit another condition. A four-trade SHORT loss is a forward-monitoring question,
not a new threshold. Preserve the profitable long-window side and proceed to
the post-verdict action.

Raw pass-through is a candidate, never an automatic promotion. If it wins the
historical comparison but the exposed terminal tail fails, retain it only as an
immutable forward candidate and return `INSUFFICIENT_EVIDENCE` or
`UNSUITABLE_FOR_CURRENT_MARKET` according to the evidence contract. Never use a
zero-approval side as a silent substitute for completing this checkpoint.

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
The core evidence reference must point to `result.json` inside its completed
core-research bundle. Release verification rehashes every artifact named by the
adjacent completed manifest; an isolated result JSON is not release evidence.
The draft freezes separate canonical core-config and core-export SHA-256 values,
deterministic-gate config/context fingerprints, and effective runtime
config/context fingerprints. The command derives these identities from the
evidence and rejects any cross-lineage artifact; do not copy one fingerprint
into another field merely because both describe the same conceptual strategy.
Incomplete evidence must produce `INSUFFICIENT_EVIDENCE`, even when the partial
economics look unsuitable.

## 8. Persist the full-period chart and choose an action

The last research computation is mandatory and uses the exact final gate over
the full frozen export:

```bash
yarn ai-train --strategy <Strategy> --file <merged-export-part1.jsonl> \
  --localOnly --chart --json --output <full-period-ai-train.json> \
  -n 0 --minQuality 4 --terminalWindows=1460,1095,365,180,90,30,7
```

The command must scan the full dataset (`-n 0`), persist the UI chart snapshot,
and write structured output. Record the dataset/export SHA, gate/context
fingerprints, selected time bounds, output SHA, and chart persistence result in
immutable evidence. A chart from another gate/config lineage is not acceptable.

Then write the final historical/forward decision input and run:

```bash
yarn strategy:release decide --input <decision-input.json> \
  --out <decision.json>
```

Reference the report as `chartArtifact: { path, sha256 }`. The command hashes
and parses that exact file and requires a persisted chart, zero evaluation
errors, the same strategy, `local-deterministic` mode, `recent=0`, no explicit
date narrowing, and a non-empty full-export scan. Never copy a plausible hash
into the input without the file. Likewise, `forwardTest.runtimeTarget` is
either null or the exact `{ userName, deploymentId, accountId,
strategyConfigName }`; do not substitute a self-declared “resolved” boolean.
Null on the research machine yields `MICRO_FORWARD_READY` with
`requiresRuntimeBinding=true`, not failed evidence. Transfer the secret-free
handoff to the runtime server, resolve its IDs there, verify the portable
fingerprints, then rerun `decide` there.

Case handling is deterministic:

1. Complete positive ALL/LONG/SHORT on 3y/4y/max, sparse or exposed recent
   loss, candidate implemented, chart present: micro-forward at risk 1.
2. Supported causal recent direction failure with an untouched tail: one repair
   round, then rerun the full matrix and chart.
3. Profitable raw side hidden by the current gate: complete the five side-rescue
   variants; pass-through is allowed but must pass chronological guardrails.
4. Positive aggregate hiding a failed long-window side: do not hide the side;
   repair within budget or stop.
5. Incomplete 3y/4y/max coverage, reconciliation, chart, or implementation:
   return the explicit blocker rather than “wait”. A server-owned target that
   is unavailable locally produces a ready handoff, not a blocker.
6. Risk-only changes: keep the same logic lineage and add immutable loss-scale
   evidence; never discard earlier logic history.

For an authorized local `MICRO_FORWARD_READY`, transfer the immutable handoff
without credentials to the runtime server. There, verify the exact runtime
deployment/account/connector/strategy target, freeze the candidate fingerprints,
set only its `MAX_LOSS_VALUE=1`, retain both directions, rerun `decide`, and
start the forward runner only after `START_MICRO_FORWARD`. Do not promote the
composition, increase risk, change unrelated runtime config, or manually place
orders. If the target is ambiguous on the runtime server, report that binding
problem separately from research validity.

When a user later authorizes a runtime deployment, copy the verified
`compositionId` into that deployment strategy's `releaseCompositionId`. The
runtime lineage and UI marker selector then require that id in addition to
git/config/gate/context logic fingerprints. `MAX_LOSS_VALUE` is recorded as a
separate immutable risk-scale timeline and used to normalize PnL/drawdown to the
release risk unit; it does not select or hide the logic timeline. Omitting the
composition id keeps release markers explicitly missing and cannot borrow
another composition's evidence.

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
  --localOnly --chart --json --output <full-period-ai-train.json> -n 0 \
  --terminalWindows=1460,1095,365,180,90,30,7

yarn ai-pocket-search --strategy <Strategy> \
  --file <merged-export-part1.jsonl> -n 0 --validationSplit 0.2 \
  --testSplit 0.2 --sealTest --maxDepth 2 --minSupport 25

yarn strategy:release profile --input <trades.jsonl> --variant <finalist-id> \
  --startTime <start-ms> --endTime <end-ms> --days 7,30,90 \
  --out <monitoring-profile.json>

yarn strategy:release create --input <release-draft.json> \
  --root data/strategy-release

yarn strategy:release verify \
  --input data/strategy-release/releases/<Strategy>/<release-id>.json

yarn strategy:release decide --input <decision-input.json> \
  --out <decision.json>
```

Use `ai-gate-ablation.mjs` for the fixed gate candidate and its held-out
comparison. Do not use temporary parsers when permanent research tooling covers
the analysis.
