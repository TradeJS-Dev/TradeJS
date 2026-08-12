---
name: strategy-release
description: Evaluate one TradeJS core-strategy plus deterministic AI-gate composition for runtime readiness, improve a bounded recent direction failure, start an authorized MAX_LOSS_VALUE=1 micro-forward test, or diagnose why a released composition behaves differently live. Use for bounded strategy release research, current-market suitability verdicts, runtime divergence versus expected drawdown or generalization failure, immutable release evidence, full-period chart handoff, and prospective testing.
---

# Strategy Release

Evaluate exactly one composition:

`frozen core config + frozen deterministic AI gate + frozen execution/context assumptions`

Operate in one explicit mode: `release` or `diagnose-live`. A release run may
end in an authorized micro-forward action, but only after the exact candidate,
runtime target, risk scale, and immutable evidence are resolved.

## Non-negotiable safety boundary

- Keep `LONG` and `SHORT` enabled. Report `ALL`, `LONG`, and `SHORT` separately.
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
  reconciliation failure, lineage mismatch, or contaminated point-in-time
  evidence. Return the appropriate insufficient-evidence verdict.
- Research runs in the local checkout/Redis; live signals and deployments run
  on the runtime server. Never infer that a production deployment, account,
  credential, signal, or trade is absent because it is missing locally. Produce
  a portable handoff locally, then resolve server-owned bindings on that server.
  Never copy or compare API credentials through release evidence.

## Select the mode

### Release

Read [references/release-workflow.md](references/release-workflow.md),
[references/verdict-contract.md](references/verdict-contract.md), and
[references/evidence-retention.md](references/evidence-retention.md) completely.

Use the fixed research budget:

- three preregistered causal core families;
- five variants per family;
- one total isolated-long core finalist;
- one deterministic AI-gate tuning round;
- one optional recent-direction repair round, only when the failed window has
  at least 20 independent target-side trades, a preregistered causal mechanism,
  an unexposed evaluation tail, and no earlier repair round;
- one final core-plus-gate composition and one release verdict.

Do not add a sixteenth core variant, reopen a viewed holdout, tune another gate
round, or substitute a different core/gate snapshot without starting a new
immutable release lineage.

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
- Use the full-statistics workflow from `$strategy-backtest-research`. In
  addition to the maximum cached window, always report the same final
  composition on trailing 3-year, 4-year, and 5-year-or-maximum-available
  slices. In the current cache, label the 1800-day maximum honestly rather than
  pretending it contains 1825 days.
- Show `N`, net `PnL`, `PnL/trade`, `PF`, `WR`, realized MaxDD, and cadence/day
  for `ALL`, `LONG`, and `SHORT` in every reported window. Calculate aggregate
  `PnL/trade` as aggregate PnL divided by aggregate N, never as the mean of side
  averages. Label LONG/SHORT drawdown side-only and ALL drawdown aggregate
  portfolio.
- Keep control and every candidate `configId` separate. Require complete
  manifests and exact N/W/L reconciliation; allow only documented per-symbol
  PnL rounding.
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
- End every completed release research run with `yarn ai-train --localOnly
--chart -n 0` over the full frozen export. Persist the structured report and
  hash its chart/evaluation lineage into immutable evidence. Missing or stale
  chart evidence blocks forward execution.

## Mandatory post-verdict action

The release verdict and the next action are separate. Run
`yarn strategy:release decide --input <decision-input.json>` after the final
historical matrix and chart are frozen.

The decision input must reference the structured chart report by both `path`
and `sha256`; `decide` recomputes the file hash and verifies that it is a
successful full-period local-deterministic chart run for the same strategy. A
forward target is not a boolean. Local research normally leaves `runtimeTarget`
null and returns `MICRO_FORWARD_READY`; on the runtime server bind the handoff
to that server's exact `userName`, `deploymentId`, `accountId`, and
`strategyConfigName`, then rerun `decide` there.

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
- `STOP_RESEARCH`: preserve the evidence and explain which 3y/4y/max-window or
  direction edge failed.

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

## Ready prompts

Release:

```text
Use $strategy-release in release mode for <Strategy>. Evaluate config <Strategy>:ai as one core + deterministic AI-gate composition. Use only --cacheOnly historical backtests over the maximum common cached window; report 3y, 4y, and 5y-or-maximum-available plus terminal ALL/LONG/SHORT statistics; keep LONG and SHORT enabled; apply the fixed 3 causal families × 5 variants budget, one isolated-long finalist, one gate round, and at most one supported recent-direction repair. Set llmComparison=off. Finish with full-period `ai-train --localOnly --chart -n 0`, immutable evidence, one release verdict, and `strategy:release decide`. If the decision is START_MICRO_FORWARD and the exact target is resolved, start only that forward deployment at MAX_LOSS_VALUE=1; never promote it or increase risk automatically.
```

Diagnose live:

```text
Use $strategy-release in diagnose-live mode for <Strategy>. Compare immutable release evidence <path-or-id> with runtime evidence <path-or-id> for the exact released core + deterministic gate composition. Set llmComparison=ai-approved for advisory comparison only. Establish config/context/replay parity before classifying the result. Return one diagnose verdict and do not tune or mutate runtime config, MAX_LOSS_VALUE, orders, daemon, deployment, or promotion state.
```
