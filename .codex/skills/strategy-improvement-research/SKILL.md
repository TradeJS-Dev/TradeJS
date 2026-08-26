---
name: strategy-improvement-research
description: Conduct a new bounded professional research lineage to improve one TradeJS strategy’s core and deterministic gate, revalidating prior candidates first and continuing beyond audits or failed first rounds until a reproducible best candidate is frozen. Does not publish or change production.
---

# Strategy Improvement Research

Require one exact strategy name. Run operational commands from the TradeJS
project. Before applying candidate source edits, create one dedicated strategy
worktree per immutable research lineage from the exact frozen production or
control SHA. Keep the canonical strategy checkout clean, run source edits and
checks in the worktree, and set `PROJECT_CWD` to the canonical Project and
`TRADEJS_SOURCE_REPOSITORY_ROOT` to the exact worktree. If the task is already
scoped to a dedicated worktree, validate and reuse it instead of nesting
another one. A lineage that only re-scores existing artifacts and makes no
source edits does not need a worktree.

## Source isolation

- Inspect the owning repository's worktree list and verify the frozen baseline
  SHA before creating or reusing the lineage worktree. Do not use an unrelated
  old worktree, scratch directory, generated artifact, or clone as the source
  root.
- Evaluate candidates sequentially in the same lineage worktree. Before
  replacing a rejected candidate, freeze its exact source diff, build hash,
  resolved config, run lineage, and outcome in Project-owned immutable
  evidence, then restore only that disposable worktree to the frozen baseline.
- Keep any temporary Project package overlay explicit and restore it to the
  verified stable package after each candidate or before handoff. A source
  worktree does not isolate `TradeJS-Project/node_modules`.
- If no new candidate is selected, verify the canonical checkout was never
  changed and remove the disposable worktree only after all evidence is
  frozen. If a candidate is selected, commit only that candidate and its tests
  on the worktree branch and hand off the exact commit SHA; do not retain
  rejected behavior as source commits.

## Authority boundary

You may refresh research artifacts, run cache-backed research, edit strategy
core/gate/tests, and commit the selected source candidate locally. Do not push,
publish packages, edit the Project’s production composition, deploy, start a
forward test, or change live risk. Those belong to `$strategy-forward-start`.

## Orchestration boundary

This skill owns the complete improvement lineage: prior-candidate inventory,
hypothesis-family choice, trial budget, parent/child decisions, candidate
selection, and final handoff. Delegate each preregistered core implementation
and backtest to `$strategy-backtest-research`; that skill returns reconciled
experiment evidence and does not choose the next candidate. After freezing the
complete core board, delegate one independent deterministic-gate board for the
baseline and for every complete, reconciled, behavior-changing core candidate
to `$ai-train-local-research`; it must not reopen core selection. Read those
specialist skills when their stage begins instead of duplicating their command,
metric, or reporting contracts here.

Before preregistration, read
[`references/final-composition-board.md`](references/final-composition-board.md).
It defines candidate-specific gate isolation, common partitions, the final
composition ledger, and the mandatory visual artifacts.

## Required contour

1. Start a new immutable research lineage. Freeze data bounds, point-in-time
   universe, symbols, interval, fees/slippage, execution assumptions, risk
   normalization, objective, holdout exposure, and trial ledger.
2. Inventory and deduplicate prior production and research candidates. Re-score
   compatible candidates and exact-bridge any plausibly competitive
   incompatible candidate on the new common period before inventing changes.
   Old winners are competitors, not automatic controls and not erased.
3. Reconstruct the market thesis and opportunity map. Select at least three
   distinct causal families: exploit, repair, and explore/falsify.
4. Evaluate one preregistered candidate per family. Continue viable families
   with evidence-driven children and use remaining slots for direction-policy
   or Pareto rescue. The default cap is 12 genuinely new behaviors. An audit,
   parser fix, no-op, or rescoring of an old behavior does not consume a slot.
   Execute each frozen experiment through `$strategy-backtest-research` and
   consume its verified result as evidence for the next orchestration decision.
5. Do not stop at the audit, baseline, first failed round, or a sparse recent
   tail. Stop only when a reproducible best candidate is frozen, the fresh
   budget is exhausted, or every remaining family has a recorded hard causal
   blocker.
6. Keep one common chronological core tail sealed during core discovery when
   coverage permits. Freeze the complete raw-core board before any gate result
   may influence core-family selection. Track all exposed core and gate tests
   for multiple-testing/deflated-Sharpe interpretation.
7. Freeze an acceptance-grade export for the baseline and every complete,
   reconciled, behavior-changing core candidate. Give each export its own gate
   discovery and exactly one selected deterministic gate; never reuse another
   core's gate metrics or compare a gated candidate with an ungated baseline.
   On the production core export, also replay the exact current production
   AI-gate and bind it to its checksum-verified gate-authority report. This
   `production core + current AI-gate` composition is the mandatory baseline;
   the production core with its newly rebuilt gate is a separate research
   candidate and must not replace the current-gate baseline.
   Use common calendar train/tuning/test boundaries and open every sealed gate
   tail together only after all per-core gate variants are frozen. Run every
   gate board through `$ai-train-local-research`; do not retune or relabel the
   raw-core result inside gate tooling.
8. Build the final leaderboard from the mandatory `production core + current
AI-gate` baseline and `core + own deterministic gate` research candidates,
   including `production core + rebuilt gate` as its own candidate. Preserve
   raw-core metrics in a separate diagnostic table. Apply the final selection
   rules and multiple-testing denominator to the complete core-by-gate trial
   ledger, not only to the winning core or gate.
9. Generate and checksum the mandatory final-composition dashboard and
   cumulative-equity chart with the permanent script from the referenced
   contract. A metrics-only handoff or a chart mixing raw and gated candidates
   is incomplete.
10. Run package formatting, typecheck, tests, and build in the lineage worktree.
    Commit only the selected candidate and its tests on that worktree branch;
    preserve rejected experiments as immutable evidence, not source clutter.

## Selection objective

First require causal/reconciliation validity and positive aggregate
out-of-sample expectancy per risk after costs. Then rank by probabilistic or
deflated Sharpe, realized MaxDD/tail/recovery, worst loss and loss streaks,
losing-month streak, fold/regime stability, concentration, cost robustness,
and cadence. Full-period PnL, win rate, and 7d/30d/180d profitability are
diagnostics, not standalone optimization targets. Classify window support as
underpowered below 20 events, diagnostic at 20–49, and selection-grade at 50+.

## Handoff

Create or update the existing checksum-verified strategy-release/candidate
manifest rather than inventing a second pointer format. Freeze candidate ID,
source/package SHA, full resolved core config, deterministic gate/context,
direction policy, evidence hashes, trial count, metric matrix, chart, freshness,
limitations, and forward-test eligibility. End with the selected candidate,
why it beat production and prior candidates, and exactly one next skill.

The handoff must link both visual artifacts for the final compositions:

- `final-composition-dashboard.{svg,png}` with KPI deltas against the exact
  production-core + current-AI-gate baseline, terminal
  `365d/180d/90d/30d/7d` PnL, and the all-candidate PnL-versus-MaxDD plane;
- `final-composition-equity.{svg,png}` with cumulative PnL for the gated
  production baseline, the rebuilt production-core gate, and every final
  `core + own gate` composition over the common comparison window.
