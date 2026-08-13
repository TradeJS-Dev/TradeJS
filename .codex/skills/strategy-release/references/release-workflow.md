# Release workflow

## Contents

1. Environment boundary and frozen release question
2. Historical audit, universe, and baseline
3. Three causal core rounds and belief updates
4. Cadence-diverse rescue and direction policy
5. Isolated-long, gate research, and recent repair
6. Full report, chart, release evidence, and prospective action

Use this workflow to evaluate one frozen core plus deterministic AI-gate
composition. Do not use it to promote the composition.

Before this workflow, complete
[historical-hypothesis-audit.md](historical-hypothesis-audit.md). Existing
evidence and untested strategy commits are inputs to hypothesis selection, not
optional background reading.

Then complete the thesis, opportunity map, hypothesis portfolio, and adaptive
belief updates from
[professional-research-loop.md](professional-research-loop.md). These artifacts
make the three families strategy-specific rather than a generic sweep.

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
- an evidence-limitation classification and claim ceiling from
  [evidence-limitations.md](evidence-limitations.md); never collapse
  retrospective-universe provenance into causal leakage;
- the trading thesis, opportunity-map SHA, protected edge, dominant loss
  source, cadence bottleneck, and exploit/repair/explore-or-falsify roles;
- three causally distinct core hypothesis families;
- the SHA of the complete historical hypothesis inventory, the bridge table for
  every stronger prior result, and the disposition of each untested behavior;
- the three-round allocation for every family: one anchor candidate in round 1,
  two child candidates in round 2, and two child candidates in round 3;
- the deterministic post-round-3 rescue rule: seed ranking, cadence-diversity
  rule, one child per seed, and acceptance/stop criteria;
- the round-1 resolved configs plus the rule that turns prior metric, matching,
  and trace evidence into the two next-round variants;
- candidate ranking and tie-break rules;
- non-target-side invariance or occupancy-spillover rule;
- the one allowed deterministic gate tuning round;
- `llmComparison: off | ai-approved`;
- required evidence and terminal conditions.

Treat the common control as a separate frozen reference. The first three rounds
allow five candidate variants per family and 15 total at most. The mandatory
rescue board may add exactly one child for each of up to three selected seeds,
for 18 core candidates total at most. Exact round-2, round-3, and rescue configs
are intentionally not guessed before their parent evidence exists, but each
must be preregistered in a new immutable child spec before its run. The
allocation is not a rolling invitation to add nearby thresholds after seeing
results. Record every attempted, failed, rejected, and retained cell in the same
trial ledger.

## 2. Freeze cached historical coverage

Resolve the intersection of cached candle and required causal context coverage
for the complete ordered ticker universe. Freeze the maximum common half-open
window `[start, end)` and its proof. Use that same window, universe, connector,
interval, fees, slippage, entry delay, and context settings for every historical
control and candidate comparison.

Inside that maximum cached envelope, freeze a timestamp-grouped chronological
core release tail before round 1. Core improvement and rescue rounds may use
only the development/tuning interval ending before that tail. Commands must not
print, rank, or otherwise expose tail economics. After rescue freezes the
finalist, the isolated-long/final comparison opens the tail exactly once and
evaluates the complete maximum cached window. This preserves an untouched test
while still using every available candle in the terminal release matrix.

Before accepting the current control, bridge every previously strong result to
this contract. A result from another duration, ticker cohort, cost model, or
source/config lineage is not directly comparable, but it is also not disposable.
Rerun its exact causal config under the current frozen dimensions when it
dominates or materially challenges the baseline. Do not proceed to novel
hypotheses until the bridge explains why a prior positive strategy result became
weaker, or reproduces it as a current candidate.

A bridge rerun that tests a different core behavior/config consumes a candidate
slot and belongs in the multiple-testing ledger. Prefer it as a round-1 anchor;
when discovered later, it may occupy a rescue slot. Recomputing the exact frozen
control or translating metadata without changing behavior does not consume a
candidate slot. This keeps prior evidence mandatory without turning it into
unaccounted extra search.

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
When no composition qualifies, the same matrix remains mandatory for the
authoritative control, best aggregate candidate, best LONG candidate, best
SHORT candidate, and every rescue child. A failed verdict is not permission to
replace the tables with a leaderboard or artifact link.

## 3. Capture the control

Run the frozen control as a complete, run-scoped experiment. Export only after
the manifest finishes and keep chunks. Reconcile Redis N/W/L/PnL against
completed-trade rows. Report full-window and preregistered terminal metrics for
`ALL`, `LONG`, and `SHORT`, including zero-trade cohorts.

Do not disable a weak side inside the authoritative raw-core result. Record
separate control statuses for ALL, LONG, and SHORT so the later deterministic
AI gate can evaluate side cohorts explicitly. An explicit direction-policy
candidate may later suppress that side while keeping this raw evidence visible.

## 4. Run and analyze three causal core rounds

Audit and infrastructure repairs do not count as a core round. If a parity or
package-boundary defect is discovered, fix and verify it, rebuild the frozen
control if necessary, then continue from round 1. Do not present the bug fix as
the strategy-improvement result.

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

If a matched one-field comparison has an opposing supported LONG/SHORT effect,
run `directional-parameter-checkpoint.mjs` before freezing the next children.
Follow [directional-parameter-split.md](directional-parameter-split.md). A
target-only override or required detector-state isolation consumes the normal
child/rescue budget; it does not grant extra trials. Preserve the global field
as the exact legacy fallback and audit non-target identity or occupancy
spillover.

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
  "familyDecision": "continue|retire|nominate_for_rescue",
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
records no same-family refinement children; it records only
`nominate_for_rescue` or `retire`. The cross-family rescue board, not an
individual round-3 family, chooses the next children and the eventual isolated
finalist. Hash the payload and cite it in the child research note/spec lineage
so another Codex run can reconstruct why the child exists without reading an
informal narrative.

Do not derive a child from displayed losers, outcome fields, or the sealed core
release tail. Do not create “best value ± epsilon” variants without a causal
transition hypothesis. Complete rounds 2 and 3 for every still-viable family
even when an earlier candidate is already profitable. A family may retire
early only when immutable evidence is invalid, the intervention is a no-op,
the mechanism is falsified, required causal signal-time context is unavailable, or
no causal signal remains to test. If all families retire, continue to the
rescue-board decision rather than manufacturing variants or stopping early.

Missing effective-dated exchange membership is not the same as missing causal
signal-time context. Keep the identical retrospective current cohort for
control/candidate matching, run membership-age/incumbent sensitivity where the
cache supports it, cap the claim at `micro_forward_only`, and continue. Do not
retune the symbol cohort after seeing candidate economics.

The carried control is the best **eligible** parent under the frozen rule. A
failed candidate is never relabelled a winner: if its trace supports another
causal test but its economics fail, retain the preceding control and record the
failed candidate only as diagnostic parent evidence for the two child variants.

When a direction-targeted policy is architecturally isolated, require exact
non-target identities/N and PnL equality within documented rounding. When
position occupancy, cooldown, or order lifecycle can affect the opposite side,
measure added/removed identities and require the preregistered non-regression
rule instead.

### Mandatory post-round-3 core rescue board

Build this board even when no candidate passed the frozen economic rule. Use
only complete, reconciled, non-no-op development evidence; keep the release tail
sealed.

1. Build the Pareto frontier across PnL/trade, PF, realized MaxDD, support,
   terminal pass count, cost stress, Holm-adjusted evidence, and cadence.
2. Select up to three diagnostic seeds while maximizing cadence separation.
   Prefer one seed from each observed cadence tercile; if a tercile is empty,
   fill the slot with the candidate farthest in cadence from already selected
   seeds. For direction-targeted families, form cadence regions from the target
   side and keep ALL cadence as an aggregate guardrail; for whole-strategy
   families, use ALL cadence. When fewer than three valid seeds exist, record why
   every missing slot is impossible.
3. For each seed, identify one dominant causal failure using trade identities,
   matched/added/removed outcomes, occupancy, trace skips/conversions, side,
   regime, fold/month, concentration, payoff tail, and cost stress.
4. Freeze exactly one rescue child per seed. The child must address that failure
   through a new causal transition or payoff mechanism and state its predicted
   trace and metric effect. An adjacent threshold nudge is invalid unless a
   measured discontinuity makes that threshold causal.
5. Run each child against the original frozen authoritative control. Use the
   seed's prior artifact as a diagnostic comparator, not as an eligible carried
   control unless the seed already passed the frozen rule.

The rescue board is bounded to three new variants and raises the lineage cap to 18. It is not a fourth unconstrained search round. After its analysis, select a
finalist only if it passes the original frozen rule. `STOP_RESEARCH` is allowed
only when all rescue slots have completed or are impossible for recorded hard
reasons and the historical inventory contains no stronger unbridged result that
could occupy a slot. A remaining reconstructable historical backlog after the
18-variant cap yields incomplete evidence, not a claim that no strategy edge
exists.

Here, `valid seed` means only complete, reconciled, behavior-changing, and
non-no-op. It does **not** mean release-eligible. Low support/cadence, failed
Holm, negative terminals, or negative PnL are measured rescue failure modes,
not reasons to leave a slot empty. A slot may be impossible only when there is
no such candidate in a distinct cadence region or no causal point-in-time child
can address its diagnosed failure.

Decision regression: suppose one dense candidate has 244 target-side trades but
negative PnL/PF, one sparse candidate has 80 target-side trades and positive
PnL/PF but fails support/terminals/Holm, and a prior higher-cadence positive
configuration was tested on a different universe. The correct action is not
`STOP_RESEARCH`. Put the dense and sparse candidates on the diagnostic frontier,
bridge the prior configuration to the frozen contract, choose up to three
cadence-diverse seeds, and spend one causal rescue child per selected seed. Only
the children that pass the original rule can become finalists.

### Mandatory direction-policy checkpoint

After the rescue board, read and apply
[direction-policy.md](direction-policy.md). Do this before concluding that no
composition finalist exists.

If one raw side passes the preregistered useful-side rule while the other side
is the dominant aggregate loss, nominate the best complete side-qualified core
handoff even when raw ALL failed. The handoff is not an eligible raw-core winner
and must remain labelled as such; it exists so the single gate round can test
whether an explicit direction policy salvages the composition. The same rule
applies when the current gate hides a useful raw side.

Persist the checkpoint for all three outcomes:

- `losing_side_contamination`;
- `profitable_side_hidden`;
- `no_side_salvage`.

Neither `UNSUITABLE_FOR_CURRENT_MARKET` nor `STOP_RESEARCH` is valid while a
triggered checkpoint is absent. A useful retained side that later fails
terminal or cost rules is a legitimate rejection; skipping its policy test is
not.

## 5. Select one isolated-long finalist or side-qualified handoff

After the rescue board and direction-policy checkpoint, select at most one raw
core finalist across all families using the frozen rule. When none qualifies,
the checkpoint may instead select at most one complete side-qualified handoff
whose useful side passed the frozen useful-side rule. Do not relabel it a core
winner. If neither exists, use the authoritative control as the diagnostic
handoff so the required full report and chart still have an exact lineage.

Rerun the chosen cell alone over the complete maximum common cached window and
frozen universe, opening the chronological core release tail for the first and
only time. This is the only isolated-long/handoff run allowed in the lineage.

Require complete run/export reconciliation and agreement with the screened
cell within the preregistered reset/grid tolerance. Investigate any difference
as state/reset contamination; do not choose the more favorable run.

The isolated-long result may confirm or reject the frozen finalist or quantify
the side-qualified handoff. It may not generate a fourth core-improvement
round. Any new hypothesis after the tail is opened starts a new release lineage
with a future unexposed tail.

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

### Mandatory side recovery and containment checkpoint

Before freezing the five gate variants, build this coverage table for raw core
and current qN+ approvals in every full/terminal window:

```text
ALL/LONG/SHORT: raw N, PnL, PnL/trade, PF, WR, MaxDD, cadence
ALL/LONG/SHORT: gate-approved N, approval share, same economics
```

A side requires recovery analysis when its raw cohort is positive or passes the
preregistered side edge rule while the current gate approves zero/negligible
support, or when removing that side materially destroys aggregate edge. A side
requires containment analysis when it is the dominant loss while the opposite
raw side passes the useful-side rule. Do not call the strategy unsuitable
merely because the current gate discarded a useful side or because raw ALL
mixed it with a losing side.

For recovery, freeze exactly five gate variants before looking at tuning/test
outcomes:

1. current deterministic gate control;
2. current gate plus raw pass-through for the target side;
3. current gate plus one rounded causal target-side pocket found on train only;
4. current gate plus the target-side pocket and one preregistered protective
   exclusion;
5. direction-aware replacement: best preregistered policy per side, including
   raw pass-through where it is the frozen candidate.

For containment, use the five variants and semantics frozen in
[direction-policy.md](direction-policy.md): current gate, failing-side hard
block, retained-side pass-through plus block, causal failing-side repair, and
direction-aware replacement. Prefer the explicit gate block over mutating the
raw core side toggle. If a core-toggle equivalence candidate is tested, keep it
separate and require entry-identity equivalence.

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
Keep continuous-run terminal slices distinct from standalone horizons. When no
composition qualifies, report the authoritative control and best
aggregate/LONG/SHORT/direction-policy attempts with the same matrix before
issuing a negative verdict.

Then apply the complete chat/report contract from
`$ai-train-local-research/references/reporting.md`: outcome/tail risk, cadence
and fan-out, risk-adjusted metrics, quality and direction, runtime execution
bridge, validation, acceptance checks, reject reasons, and conclusion. Use
explicit `n/a` values for unavailable fields; do not omit the sections because
the composition was rejected.

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
the full frozen export. If no gate candidate qualifies, use the frozen current
gate over the authoritative control or selected side-qualified handoff and
label the output `diagnostic-only`; the command and full report are still
required:

```bash
yarn ai-train --strategy <Strategy> --file <merged-export-part1.jsonl> \
  --localOnly --chart --json --output <full-period-ai-train.json> \
  -n 0 --minQuality 4 --directionPolicy <policy> \
  --terminalWindows=1460,1095,365,180,90,30,7
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

1. Complete positive ALL plus every active approved side on 3y/4y/max, with an
   explicit zero row for any policy-suppressed side, sparse or exposed recent
   loss, candidate implemented, chart present: micro-forward at risk 1.
2. Supported causal recent direction failure with an untouched tail: one repair
   round, then rerun the full matrix and chart.
3. Profitable raw side hidden by the current gate: complete the five side-rescue
   variants; pass-through is allowed but must pass chronological guardrails.
4. Useful raw side mixed with a losing side: complete the five direction-policy
   variants. The losing raw side stays visible, while a tested `long_only` or
   `short_only` gate may become the composition policy if the retained side and
   aggregate approved stream pass every guardrail.
5. Positive aggregate hiding a failed long-window side: do not hide the side;
   repair within budget or stop.
6. Incomplete 3y/4y/max coverage, reconciliation, chart, or implementation:
   return the explicit blocker rather than “wait”. A server-owned target that
   is unavailable locally produces a ready handoff, not a blocker.
7. Risk-only changes: keep the same logic lineage and add immutable loss-scale
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
  --directionPolicy <both|long_only|short_only|direction_aware> \
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
