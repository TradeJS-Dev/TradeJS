---
name: strategy-release
description: Evaluate one TradeJS core-strategy plus deterministic AI-gate composition for runtime readiness, or diagnose why a released composition behaves differently live. Use for bounded strategy release research, current-market suitability verdicts, runtime divergence versus expected drawdown or generalization failure, immutable release evidence, and approval-safe handoff without changing runtime configuration or placing orders.
---

# Strategy Release

Evaluate exactly one composition:

`frozen core config + frozen deterministic AI gate + frozen execution/context assumptions`

Operate in one explicit mode: `release` or `diagnose-live`. Keep research
read-only with respect to runtime until the user separately approves a specific
mutation.

## Non-negotiable safety boundary

- Keep `LONG` and `SHORT` enabled. Report `ALL`, `LONG`, and `SHORT` separately.
- Run every historical backtest with `--cacheOnly` over the maximum common
  cached window frozen for the experiment. Never refresh or silently shorten
  history to rescue a result.
- Do not change a runtime strategy config, `MAX_LOSS_VALUE`, order state,
  daemon, scheduler, deployment, or promotion status without explicit user
  approval. `READY_FOR_RUNTIME` is a recommendation, not permission.
- Do not place, cancel, or close orders.
- Keep unpromoted candidates in forward incubation or advisory/shadow mode
  only. Never make an advisory LLM comparison part of deterministic execution.
- Stop selection on partial manifests, OOM, worker errors, missing exports,
  reconciliation failure, lineage mismatch, or contaminated point-in-time
  evidence. Return the appropriate insufficient-evidence verdict.

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
- Treat AI-gate evaluation as a later stage over the frozen core export. Do not
  let outcome or delayed-execution fields enter signal-time approval.
- Configure optional LLM comparison as `off` or `ai-approved`. Default to
  `off`; `ai-approved` evaluates only deterministic-gate-approved rows and is
  advisory. It cannot choose the core, tune the deterministic gate, change a
  verdict, or authorize runtime action.

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
Use $strategy-release in release mode for <Strategy>. Evaluate config <Strategy>:ai as one core + deterministic AI-gate composition. Use only --cacheOnly historical backtests over the maximum common cached window, keep LONG and SHORT enabled, apply the fixed 3 causal families × 5 variants budget, select one isolated-long finalist, and allow one gate tuning round. Set llmComparison=off. Produce immutable evidence and one release verdict. Do not change runtime config, MAX_LOSS_VALUE, orders, daemon, deployment, or promotion state.
```

Diagnose live:

```text
Use $strategy-release in diagnose-live mode for <Strategy>. Compare immutable release evidence <path-or-id> with runtime evidence <path-or-id> for the exact released core + deterministic gate composition. Set llmComparison=ai-approved for advisory comparison only. Establish config/context/replay parity before classifying the result. Return one diagnose verdict and do not tune or mutate runtime config, MAX_LOSS_VALUE, orders, daemon, deployment, or promotion state.
```
