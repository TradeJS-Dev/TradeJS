---
name: strategy-improvement-research
description: Conduct a new bounded professional research lineage to improve one TradeJS strategy’s core and deterministic gate, revalidating prior candidates first and continuing beyond audits or failed first rounds until a reproducible best candidate is frozen. Does not publish or change production.
---

# Strategy Improvement Research

Require one exact strategy name. Run operational commands from the TradeJS
project and source edits/checks from the exact strategy repository. Set
`PROJECT_CWD` and `TRADEJS_SOURCE_REPOSITORY_ROOT` when the repositories differ.

## Authority boundary

You may refresh research artifacts, run cache-backed research, edit strategy
core/gate/tests, and commit the selected source candidate locally. Do not push,
publish packages, edit the Project’s production composition, deploy, start a
forward test, or change live risk. Those belong to `$strategy-forward-start`.

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
5. Do not stop at the audit, baseline, first failed round, or a sparse recent
   tail. Stop only when a reproducible best candidate is frozen, the fresh
   budget is exhausted, or every remaining family has a recorded hard causal
   blocker.
6. Keep one chronological tail sealed during discovery when coverage permits.
   Open it once for the final selected behavior. Track all exposed tests for
   multiple-testing/deflated-Sharpe interpretation.
7. Run package formatting, typecheck, tests, and build. Commit only the selected
   candidate and its tests in the strategy source repository; preserve rejected
   experiments as immutable evidence, not source clutter.

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
