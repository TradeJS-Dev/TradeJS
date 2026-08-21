---
name: strategy-release
description: Evaluate and iteratively improve one TradeJS core-strategy plus deterministic AI-gate composition for runtime readiness, revalidate historical candidates under a versioned professional objective, perform three new evidence-driven core rounds plus cadence-diverse rescue, test an explicit long-only or short-only direction policy when one side carries the edge, improve a bounded recent direction failure, start an authorized MAX_LOSS_VALUE=1 micro-forward test, or diagnose why a released composition behaves differently live. Use for bounded strategy release research, full-period and AI-gate reporting, current-market suitability verdicts, runtime divergence versus expected drawdown or generalization failure, immutable release evidence, chart handoff, and prospective testing.
---

# Strategy Release

Evaluate exactly one composition:

`frozen core config + frozen deterministic AI gate + frozen execution/context assumptions`

Operate in one explicit mode: `release` or `diagnose-live`. A release run may
end in an authorized micro-forward action, but only after the exact candidate,
runtime target, risk scale, and immutable evidence are resolved.

## Repository roots

Run this skill from `/Users/aleksnick/dev/tradejs/tradejs-project`. Treat that
directory as `PROJECT_CWD`: it owns `data/`, `notes/`, `.env`,
`tradejs.config.ts`, and project CLI commands such as `yarn strategy-release`,
`yarn ai-train`, `yarn ai-pocket-search`, and `yarn research:core`.

Do not start release commands from the old TradeJS source/engine checkout. Use
`TRADEJS_SOURCE_REPOSITORY_ROOT` only for source edits, source builds, and Git
lineage. Verify the source checkout explicitly before changing core or
deterministic gate code, and keep generated evidence under `PROJECT_CWD`.

## Non-negotiable safety boundary

- Keep `LONG` and `SHORT` enabled in authoritative raw-core research and report
  `ALL`, `LONG`, and `SHORT` separately. A final composition may explicitly
  suppress a failing side only through the tested direction-policy checkpoint;
  never erase that side from raw evidence.
- Run every historical backtest with `--cacheOnly` over the maximum common
  cached window frozen for the experiment. Never refresh or silently shorten
  history to rescue a result.
- Do not change runtime state without explicit user approval. When the user has
  authorized automatic forward testing, the only permitted mutation is the
  exact frozen candidate on the resolved forward deployment with
  `MAX_LOSS_VALUE=1`; do not alter another strategy, account, deployment, or
  risk limit. Never place, cancel, or close an order manually.
- Keep unpromoted candidates in forward incubation or advisory/shadow mode
  only. Never make an advisory LLM comparison part of deterministic execution.
- Stop selection on partial manifests, OOM, worker errors, missing exports,
  reconciliation failure, lineage mismatch, or actual signal-time causal
  leakage. Classify universe/holdout/provenance limitations with
  [references/evidence-limitations.md](references/evidence-limitations.md): a
  retrospective current-universe cohort caps claims but still permits matched
  research and prospective risk-1 selection.
- Research data stays in the local checkout/Redis. Desired live deployments and
  strategy configs are committed in TradeJS-Project `tradejs.config.ts`; only
  account secrets, optional manual pause controls, signals, and trades remain
  server-owned. Never infer that a production account, credential, signal, or
  trade is absent because it is missing locally. Never copy or compare API
  credentials through release evidence.

## Select the mode

### Release

Read [references/professional-research-loop.md](references/professional-research-loop.md)
and [references/release-workflow.md](references/release-workflow.md) completely.
Read [references/research-objective.md](references/research-objective.md)
completely before freezing the release question or ranking any old or new
candidate.
Load the other references only at their decision seam:

- read [references/historical-hypothesis-audit.md](references/historical-hypothesis-audit.md)
  while inventorying/bridging history;
- read [references/direction-policy.md](references/direction-policy.md) when a
  side checkpoint is triggered;
- read [references/directional-parameter-split.md](references/directional-parameter-split.md)
  when an isolated global field improves one direction and worsens the other;
- read [references/evidence-limitations.md](references/evidence-limitations.md)
  when classifying data/holdout/runtime limitations;
- read [references/verdict-contract.md](references/verdict-contract.md) and
  [references/evidence-retention.md](references/evidence-retention.md) only when
  preparing the final decision, handoff, or immutable record.

Use the fixed research budget:

- one new immutable lineage per release task unless the user explicitly names
  an existing lineage to continue; prior rounds and verdicts never count as new
  work;
- one mandatory historical-candidate revalidation board under the current
  objective fingerprint before novel hypotheses; metric-only rescoring and
  exact reruns of already-tested behavior do not consume new causal slots but
  remain in the global multiple-testing ledger;
- three preregistered causal core families;
- three sequential core-improvement rounds: one initial round plus two mandatory
  evidence-driven refinement rounds for every still-viable family;
- one anchor candidate per family in round 1, then two distinct child variants
  per surviving family in rounds 2 and 3;
- five candidate variants per family across the first three rounds, 15 total at
  most;
- one mandatory post-round-3 rescue child for each of up to three best
  diagnostic seeds, selected from different cadence regions when available;
  seeds need complete/reconciled/non-no-op evidence but do not need to pass the
  release rule; 18 core candidates total at most;
- one total isolated-long core finalist;
- one mandatory direction-policy checkpoint when one raw side is useful and the
  opposite side or current gate destroys the composition; this is part of the
  single gate round, not an extra unbounded search;
- one deterministic AI-gate tuning round;
- one optional recent-direction repair round, only when the failed window has
  at least 20 independent target-side trades, a preregistered causal mechanism,
  an unexposed evaluation tail, and no earlier repair round;
- one final core-plus-gate composition and one release verdict.

Do not skip the two refinement rounds merely because an initial candidate is
profitable. Retire a family early only for a recorded hard stop such as invalid
evidence, a no-op, or a falsified causal mechanism; never invent variants just
to fill the budget. Do not stop after round 3 merely because no cell passed the
release rule. Build the cadence-diverse rescue board and test its three causal
children before selecting a finalist. Do not add a nineteenth core variant,
reopen a viewed holdout, tune another gate round, or substitute a different
core/gate snapshot without starting a new immutable release lineage.

The history audit, report generation, architecture diagnosis, and bug fixing
are prerequisites, not substitutes for the requested improvement attempt. When
the user asks to bring a strategy toward runtime or propose improvements, do
not return after those activities while a valid bounded core/gate action
remains. Execute the next stage or name a hard execution blocker. A limitation
that merely caps the evidence at prospective micro-forward is not such a
blocker.

Persist a progress payload and run:

```bash
node .codex/skills/strategy-release/scripts/release-progress-checkpoint.mjs \
  --input <release-progress.json> > <release-progress-decision.json>
```

Run it after audit/baseline, after every round, and before the final response.
Its required next action is binding. A final market verdict is forbidden while
`verdictAllowed=false`. Use the v2 progress payload from
[references/research-objective.md](references/research-objective.md); the
checkpoint verifies objective/revalidation artifacts, completed core manifests,
results, traces, causal handoffs, and rescue evidence from their file hashes.
Never self-declare completion with booleans or `roundsCompleted` alone.

Before freezing round-1 families, follow
[references/professional-research-loop.md](references/professional-research-loop.md):
write the trading thesis, build and hash the opportunity map, generate competing
mechanisms, and choose an exploit/repair/explore-or-falsify portfolio. After
every round update the belief ledger and choose the next experiment from the
new evidence. The fixed budget bounds creativity; it must not replace judgment
with a parameter grid.

### Diagnose live behavior

Read [references/diagnose-live.md](references/diagnose-live.md),
[references/verdict-contract.md](references/verdict-contract.md), and
[references/evidence-retention.md](references/evidence-retention.md) completely.

Diagnose the exact released composition before proposing changes. Establish
runtime/replay/config/context parity first; only then decide whether observed
losses are expected drawdown or a generalization failure. Do not tune thresholds
inside a diagnostic lineage.

## Shared metric and evidence rules

- Use completed-trade economics and exact run-scoped exports.
- Apply the hierarchical objective, terminal support bands, historical
  candidate revalidation, and global trial ledger from
  [references/research-objective.md](references/research-objective.md). Full
  PnL, Sharpe, win rate, loss streak, losing-month streak, and any one terminal
  window are never standalone optimization objectives.
- Apply `evidence-first, novelty-second`. Before inventing hypotheses, audit the
  strategy's Git history, notes, core-research ledger/index, configs, and release
  artifacts. Persist a hash-linked hypothesis inventory. Reproduce any stronger
  prior result whose window/universe/config/cost lineage differs before treating
  a weaker current baseline as authoritative. Untested behavior-changing
  commits take priority as causally distinct anchors; refactors, duplicates,
  and already rejected hypotheses do not consume new trial slots.
- Use the full-statistics workflow from `$strategy-backtest-research`. In
  addition to the maximum cached window, always report the same final
  composition on trailing 3-year, 4-year, and 5-year-or-maximum-available
  slices. In the current cache, label the 1800-day maximum honestly rather than
  pretending it contains 1825 days.
- Show `N`, net `PnL`, `PnL/trade`, `PF`, `WR`, realized MaxDD, and cadence/day
  for `ALL`, `LONG`, and `SHORT` in every reported window. Calculate aggregate
  `PnL/trade` as aggregate PnL divided by aggregate N, never as the mean of side
  averages. Also show independent events, payoff, probabilistic/deflated Sharpe,
  adverse-cost expectancy, recovery/time-under-water, tail/CVaR, concentration,
  and the terminal support class. Label LONG/SHORT drawdown side-only and ALL
  drawdown aggregate portfolio.
- Keep control and every candidate `configId` separate. Require complete
  manifests and exact N/W/L reconciliation; allow only documented per-symbol
  PnL rounding.
- A completed variant run is not an analysis. After every core round, inspect
  the authoritative `research:core` result, report, normalized trades, matches,
  and compact research trace. Explain the metric delta through setup identity,
  matched/added/removed/changed trades, occupancy spillover, trace-funnel
  conversion, side, time, regime, concentration, payoff tail, cost stress, and
  statistical guardrails. Record a mechanism verdict of `supported`,
  `falsified`, or `inconclusive` before proposing the next variants.
- When an isolated field produces a supported opposing LONG/SHORT effect, run
  the directional-parameter classifier and test a backward-compatible
  `FIELD_LONG`/`FIELD_SHORT` split inside the existing child/rescue budget. Do
  not split fields automatically or use a simple post-signal resolver for
  detector state that was already built with the global value.
- Derive round-2 variants only from round-1 evidence and round-3 variants only
  from the combined round-1/round-2 evidence. Each follow-up gets a new
  immutable `researchId`, parent research IDs, an exact config delta, a
  predicted trace/metric effect, and a frozen selection rule before execution.
  Preserve the previous winner as the next round's matched control. Adjacent
  threshold nudges without a causal explanation are not new variants.
- After round 3, rank all complete reconciled non-no-op candidates on the
  preregistered multi-objective evidence frontier. Select up to three diagnostic
  seeds while maximizing cadence separation; prefer one from each observed
  cadence tercile when possible. For a direction-targeted family, use
  target-side cadence for separation and retain ALL cadence as a guardrail; use
  ALL cadence for whole-strategy families. For every seed, diagnose its dominant
  failure from metrics, identities, trace, terminals, regimes, and cost stress,
  then freeze one new core rescue child with a predicted causal transition. A
  failed seed remains diagnostic evidence and never becomes an eligible control
  merely because it ranked in the top three. Compare every rescue child to the
  frozen authoritative control and its seed evidence. Only after these attempts
  may the core stage conclude that no finalist exists.
- Failing support, cadence, Holm, terminal, or profitability eligibility does
  not by itself make a diagnostic seed unavailable. Those failures are the
  inputs to rescue design. A rescue slot is absent only when no complete,
  reconciled, behavior-changing candidate exists for that slot or when no
  causal point-in-time intervention can address the measured failure.
- Keep the chronological core release tail sealed throughout all three
  improvement rounds and the rescue round. These rounds may inspect
  development/tuning metrics and traces only. Freeze the finalist after rescue,
  then open the tail once in the isolated-long/final matrix. Never use that tail
  to design another variant in the same lineage.
- Freeze exact timestamps, ordered ticker universe and checksum, cached-coverage
  proof, configs, git/dirty lineage, gate/context fingerprints, fees, slippage,
  entry delay, connector, interval, and commands before viewing outcomes.
- Bind every evidence artifact to the complete Composition Lineage: clean git
  SHA, canonical core-config/core-export SHA-256, gate config-id/gate/context
  fingerprints, effective runtime config/context fingerprints, composition id
  when deployed. Freeze `MAX_LOSS_VALUE` as separate risk-scale evidence: it is
  required for economic normalization and immutable `L` markers, but changing
  it alone must not hide or invalidate unchanged core + gate logic history. Do
  not reuse one hash in several identity fields or accept a checksum-valid
  artifact from another logic lineage.
- Before accepting a deterministic gate, compare raw-core and approved `ALL`,
  `LONG`, and `SHORT` cohorts. If a raw side has positive or materially useful
  edge but the gate approves zero or negligible rows, treat this as an
  incomplete gate, not proof that the strategy is unsuitable. Spend the one
  gate round on the five direction-aware repair variants defined in the release
  workflow. A profitable raw side may be retained unchanged only after the same
  chronological validation and aggregate/non-target guardrails as every other
  candidate.
- Do not require aggregate raw-core eligibility before testing a direction
  policy. After the rescue board, if one side passes the frozen useful-side
  rule and the other side is the dominant loss, carry the best complete
  side-qualified core handoff into the one gate round and run the five variants
  from [references/direction-policy.md](references/direction-policy.md). Prefer
  an explicit deterministic-gate block so raw counterfactual telemetry remains
  available. This checkpoint may produce the single composition finalist; it
  cannot waive retained-side terminals, cost stress, support, or holdout rules.
- Reserve the gate test tail with `ai-pocket-search --testSplit <ratio>
--sealTest`. Discovery may see train and tuning economics plus only the sealed
  tail's timestamp/count bounds. It must not print, rank on, or otherwise expose
  test PnL before the five variants are frozen. Open that test exactly once with
  the fixed `ai-gate-ablation.mjs` spec. If any earlier command exposed the test
  economics, preserve the run as partial evidence and do not claim an untouched
  holdout or `READY_FOR_RUNTIME` from that lineage.
- Treat AI-gate evaluation as a later stage over the frozen core export. Do not
  let outcome or delayed-execution fields enter signal-time approval.
- Configure optional LLM comparison as `off` or `ai-approved`. Default to
  `off`; `ai-approved` evaluates only deterministic-gate-approved rows and is
  advisory. It cannot choose the core, tune the deterministic gate, change a
  verdict, or authorize runtime action.
- End every completed release research run with the full reporting contract
  from `$ai-train-local-research`, followed by `yarn ai-train --localOnly
--chart -n 0` over the full frozen export. This requirement does not disappear
  when no finalist exists: report the authoritative control plus the best
  aggregate/LONG/SHORT and direction-policy candidates, then chart the selected
  composition or the frozen current-gate control as explicitly diagnostic.
  Persist the structured report and hash its chart/evaluation lineage into
  immutable evidence. Missing or stale chart evidence blocks forward execution
  and forbids a `complete` market-unsuitable verdict.

## Mandatory post-verdict action

The release verdict and the next action are separate. Run
`yarn strategy-release decide --input <decision-input.json>` after the final
historical matrix and chart are frozen.

The decision input must reference the v2 progress artifact, selected-composition
artifact, and structured chart report by `path` and `sha256`; `decide`
recomputes their hashes and rejects a strategy, candidate, objective, composition,
or chart mismatch. A forward target is not a boolean. Local research normally
leaves `runtimeTarget` null and returns `MICRO_FORWARD_READY`; bind the handoff
to the exact Git-owned `deploymentId`, strategy declaration, and server account,
then rerun `decide` against that Project image.

- `REPAIR_RECENT_DIRECTION`: spend the single repair round, then rebuild all
  historical/chart evidence. Never tune on a handful of trades.
- `START_MICRO_FORWARD`: start the exact resolved forward deployment with
  `MAX_LOSS_VALUE=1` when authorization and target are present. An exposed test
  may still support this prospective action; it cannot support
  `READY_FOR_RUNTIME`.
- `MICRO_FORWARD_READY`: request missing mutation authorization, or when
  `requiresRuntimeBinding=true`, bind and verify the portable handoff on the
  runtime server. A missing server-owned binding in local Redis is not an
  evidence blocker.
- `FORWARD_BLOCKED`: resolve the named implementation/chart/runtime-target
  blocker; do not silently wait.
- `STOP_RESEARCH`: preserve the evidence and explain which frozen objective or
  selection-grade direction edge failed. This action is forbidden until the
  historical hypothesis inventory is bridged, the three-round ledger is complete, and the
  cadence-diverse rescue board has been attempted or has fewer than three valid
  seeds for explicit recorded reasons. It is also forbidden while a required
  direction-policy checkpoint or full AI-gate report remains unfinished.

### Forward-test rollout handshake

When the user says to start forward tests after a release verdict, treat that
as authorization for the complete rollout of that exact strategy candidate,
including its Git-owned Project declaration and image deployment. Do not publish
a production version immediately and do not wait for a second
`готово`/`ready` message:

- commit and push every strategy-owned source/gate change for the exact
  candidate; keep unrelated repo changes out of that commit and leave the
  package manifest on its current stable baseline;
- wait for the push workflow to publish a unique next-patch beta candidate and
  for its production-like Project smoke to move the npm `beta` tag; never
  install that prerelease in the committed Project or production;
- use the protected weekly stable promotion as the routine path. It publishes
  and tags one stable patch only from the current verified beta;
- wait for the weekly Project sync to batch all promoted stable packages into
  one exact dependency/lockfile update;
- in the matching Project commit, update `tradejs.config.ts` with the complete
  secret-free strategy config, `MAX_LOSS_VALUE=1`, the intended `enabled`
  state, and optional human-facing `generation`; never add a manual runtime
  version. Commit and push the package manifest, lockfile, and runtime
  declaration together;
- explicitly dispatch the matching Project publish workflow, then wait for it
  and the repository-dispatch Deploy workflow to succeed. Verify that the
  deployed runtime manifest names the Project SHA and promoted strategy package
  version, contains only stable exact packages, and resolves the expected
  `strategyRevision` and `deploymentCompositionId`;
- materialize the candidate from strategy defaults plus the selected config,
  remove deployment and mode-only fields (`ENABLE`, `ACCOUNT_ID`,
  `DEPLOYMENT_ID`, `ENV`, `MAKE_ORDERS`, `RECORD_RUNTIME_TRADES`, and
  `AI_REPLAY_ANALYSES`), retain `MAX_LOSS_VALUE=1`, and commit the secret-free
  strategy config in the Project declaration;
- run `yarn runtime-control verify` and local dry-run `signals`; stop on package
  version, config, account, or private-position blockers.

Production Redis must never receive strategy config, deployment documents, or
version pointers. It may contain only the optional manual pause override. If an
existing strategy needs a guarded cutover, pause entries before replacing the
image, verify the deployed manifest and `yarn runtime-control inspect`, then
resume only when `decide` returns `START_MICRO_FORWARD`; resume deletes the
override. A newly declared enabled strategy starts with the verified image.
Local release assessment and immutable research evidence remain CI/research
inputs and are not required by the production server or runtime UI. Report
unavailable access, package incompatibility, account/position preflight
failure, or an ambiguous target as the exact blocker.

## Return one verdict

For `release`, return exactly one of:

- `READY_FOR_RUNTIME`
- `UNSUITABLE_FOR_CURRENT_MARKET`
- `INSUFFICIENT_EVIDENCE`

For `diagnose-live`, return exactly one of:

- `RUNTIME_DIVERGENCE`
- `EXPECTED_DRAWDOWN`
- `GENERALIZATION_FAILURE`
- `INSUFFICIENT_EVIDENCE`

Follow the decision precedence and required supporting table in
[references/verdict-contract.md](references/verdict-contract.md). Do not invent
an intermediate production label.

## Short invocation prompts

Release:

```text
Use $strategy-release in release mode for <Strategy>:<config>.
```

Diagnose live:

```text
Use $strategy-release in diagnose-live mode for <Strategy>. Compare immutable release evidence <path-or-id> with runtime evidence <path-or-id> for the exact released core + deterministic gate composition. Set llmComparison=ai-approved for advisory comparison only. Establish config/context/replay parity before classifying the result. Return one diagnose verdict and do not tune or mutate runtime config, MAX_LOSS_VALUE, orders, daemon, deployment, or promotion state.
```
