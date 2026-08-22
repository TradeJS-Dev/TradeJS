# Verdict contract

Return exactly one mode-specific verdict. Put the verdict first, then the
composition/incident identity, evidence completeness, ALL/LONG/SHORT table,
causal findings, limitations, and approval-safe next action.

## Shared rules

- Treat a verdict as an evidence classification, not an authorization token.
- Keep ALL, LONG, and SHORT statuses separate. A positive aggregate cannot hide
  a failed side, and a negative side cannot be silently disabled. An explicit
  tested `long_only` or `short_only` deterministic-gate policy is allowed, but
  the suppressed raw side and its zero approved row must remain visible.
- Apply `evidence-first, novelty-second`. A release verdict is incomplete until
  the historical commit/evidence inventory is hashed, every stronger prior
  result is classified and bridged to the current window/universe/config/cost
  contract, and every selected untested historical behavior has a recorded
  disposition. Do not call a weaker new search exhaustive while comparable
  prior evidence remains unexplained.
- Bind the verdict to one `tradejs-release-objective/v2` fingerprint. Complete
  the historical-candidate revalidation board under that fingerprint and retain
  every distinct old/new behavior in the global trial ledger before ranking a
  finalist.
- A current gate that approves zero/negligible rows from a profitable raw side
  is incomplete evidence. Do not return a final market-unsuitable verdict until
  the mandatory five-variant side-rescue round has been executed and recorded.
- A raw aggregate that fails because one side is the dominant loss is not a
  final verdict while the opposite side passes the frozen useful-side rule.
  Complete the five-variant direction-containment checkpoint before rejecting
  the composition.
- `READY_FOR_RUNTIME` requires a genuinely sealed chronological gate test:
  pocket discovery may know its count and time bounds but not its PnL or feature
  outcomes. A test opened before variant freeze is permanently exposed and can
  support only historical diagnosis/forward-candidate selection in that
  lineage.
- Treat `MAX_LOSS_VALUE` as risk scale rather than decision-logic identity.
  Preserve its immutable change history, normalize monetary comparisons to the
  release risk unit, and return `INSUFFICIENT_EVIDENCE` when either scale is
  unavailable. Never compare unnormalized dollar drawdowns across risk scales.
- Treat local Redis config names/ids and deployment/account ids, and
  server credentials as environment binding rather than composition logic.
  Never infer production absence from missing local keys. A locally unbound but
  otherwise verified candidate is `MICRO_FORWARD_READY` with
  `requiresRuntimeBinding=true`; bind and reverify it on the runtime server.
  Activation (`ENABLE`) remains execution-critical and must equal the
  authorized handoff before forward execution.
- Use aggregate portfolio MaxDD for ALL and side-only realized MaxDD for each
  direction.
- Report every terminal row, but apply the support classes from
  [research-objective.md](research-objective.md). An underpowered row is `n/a`
  and a diagnostic row cannot reject a composition by itself. A selection-grade
  row may limit historical readiness and candidate rank, but no terminal
  calendar row blocks an otherwise valid risk-1 prospective test. Empty recent
  windows are cadence evidence, not losses.
- A complete release verdict, including `UNSUITABLE_FOR_CURRENT_MARKET`,
  requires the full window matrix and the complete `$ai-train-local-research`
  report. A negative verdict cannot replace omitted statistics with an artifact
  link or a short rescue leaderboard.
- Prefer `INSUFFICIENT_EVIDENCE` over extrapolation when lineage, completeness,
  parity, point-in-time validity, independent support, or reconciliation fails.
- This classifies the historical claim; it does not automatically mean stop.
  Retrospective-universe or exposed-holdout limitations require continued
  bounded research and may end in a risk-1 prospective handoff.
- Keep any unapproved next composition in forward incubation/advisory mode.
- A verdict never means “wait”. Pair it with the deterministic research action:
  bounded recent-direction repair, authorized risk-1 micro-forward, a concrete
  blocker, or stop. An exposed holdout blocks `READY_FOR_RUNTIME` but does not
  block prospective micro-forward evidence.

## Release verdicts

### `READY_FOR_RUNTIME`

Use only when all conditions hold:

- the one final core plus deterministic gate composition is immutable and
  completely reconciled;
- the bounded core loop used one anchor plus two evidence-driven refinement
  pairs per surviving family, then completed the mandatory cadence-diverse
  rescue board, never exceeded 3×5+3 candidates, and completed full
  metric/match/trace analysis before each child;
- one isolated-long finalist and one gate round followed the preregistered
  rules without reopening the held-out evidence;
- BOTH directions stayed enabled in raw evidence and ALL/LONG/SHORT were
  reported; the approved composition either passes its explicit rules for both
  sides or uses a preregistered, held-out-tested `long_only`/`short_only` gate
  policy whose retained side and ALL stream pass while the suppressed side is
  shown explicitly as zero approved support;
- full, terminal, cold-start/reset, concentration, capacity, causality, and
  current-market evidence satisfy the release contract;
- no unresolved runtime-parity or data-lineage blocker remains.
- the progress decision, selected-composition artifact, objective fingerprint,
  historical matrix, and chart all identify the same candidate/composition.

Meaning: the composition supports the strongest historical claim. The verdict
alone is not mutation authority; a `release`-mode invocation separately
authorizes the exact risk-1 rollout unless it explicitly forbids runtime
changes. Never place, cancel, or close orders manually.

### `UNSUITABLE_FOR_CURRENT_MARKET`

Use when evidence is complete and valid, but no composition satisfies the
prospective rule: positive maximum-covered economics for every active approved
side plus frozen drawdown/tail/cost/concentration/support guardrails. A recent
calendar loss alone is not sufficient. Typical evidence includes failed active
side economics, unacceptable portfolio DD/capacity, or no qualifying isolated
finalist.

Do not use this verdict merely because the first three rounds produced no
eligible finalist. It requires the historical bridge and all available rescue
slots to be complete. It also requires the direction-policy checkpoint, the
maximum-window diagnostic handoff, the full window matrix, and the complete
AI-gate report. A stronger unbridged prior result or an unresolved
reconstructable historical hypothesis makes the evidence incomplete instead.

Meaning: preserve the composition and failures as immutable research. Keep any
continued observation advisory/forward-only; do not tune around the exposed
period inside the same lineage.

### `INSUFFICIENT_EVIDENCE`

Use when a release conclusion cannot be supported, including partial/OOM/error
runs, missing common cached coverage, incomplete side cohorts, export/Redis
mismatch, unavailable point-in-time inputs, stale/open holdout, inadequate
independent support, missing cold-start evidence, ambiguous lineage, an
incomplete historical hypothesis audit, or a bounded trial cap reached while a
stronger reconstructable historical backlog remains.

Meaning: identify the smallest missing evidence item and its action ceiling.
Hard-invalid evidence must be repaired. Retrospective-universe, exposed-tail,
and prospective-support limitations do not justify waiting for perfect history:
complete the bounded contour and prepare/start the separately authorized
`MAX_LOSS_VALUE=1` micro-forward candidate. Do not convert uncertainty into
current-market unsuitability or historical readiness.

## Diagnose-live verdict precedence

Apply this order:

1. Return `INSUFFICIENT_EVIDENCE` when the released composition, incident
   evidence, or comparison completeness cannot be established.
2. Return `RUNTIME_DIVERGENCE` when material runtime/replay/config/context/
   execution non-parity explains or invalidates the observed sample.
3. With parity established, return `GENERALIZATION_FAILURE` when adequate new
   post-cutoff evidence breaches the preregistered generalization bounds.
4. With parity and adequate support established, return `EXPECTED_DRAWDOWN`
   when the observation remains inside the frozen release distribution.

### `RUNTIME_DIVERGENCE`

Require concrete mismatched evidence such as closed-candle boundary, config or
fingerprint, state restoration, causal context, deterministic gate decision,
allocator/risk/order lifecycle, fill, fee/slippage, or exit differences.

Do not call a strategy generalized or failed while material parity divergence
remains unresolved.

### `EXPECTED_DRAWDOWN`

Require exact composition parity, adequate incident/forward support, and losses,
streak, drawdown, cadence, concentration, sides, and regimes within the frozen
release bounds. This verdict does not imply future recovery or authorize higher
risk.

### `GENERALIZATION_FAILURE`

Require exact composition parity and adequate independent post-selection
evidence outside the release cutoff. Show which preregistered ALL/LONG/SHORT,
regime, concentration, or drawdown bound failed. Do not use an exposed tuning
window or a handful of correlated symbol rows as proof.

### `INSUFFICIENT_EVIDENCE`

Use when runtime evidence is remote/unavailable, ids cannot be linked, the
incident window is incomplete, parity is unknown, sample/event support is too
small, release bounds are missing, or evidence has conflicting lineage.

## Required final shape

```text
VERDICT: <exact enum>
MODE: <release|diagnose-live>
COMPOSITION: <core fingerprint> + <deterministic gate fingerprint>
EVIDENCE: <complete|incomplete> — <one-line reason>
HISTORY AUDIT: <inventory SHA> — <bridged/excluded/unresolved counts>
PRIOR BRIDGE: <strongest prior result and current-contract disposition>
RESCUE BOARD: <up to 3 seed cadence/failure/child/result rows, or hard reason per empty slot>
DIRECTION POLICY: <trigger, five variants, selected/rejected policy, checkpoint SHA>

ALL/LONG/SHORT: N, PnL, PnL/trade, PF, WR, realized MaxDD, cadence/day
WINDOW MATRIX: <full/3y/4y/max-covered/365d/180d/90d/30d/7d for control and best aggregate/LONG/SHORT/policy attempts>
AI-GATE REPORT: <decision, qN+, full/terminal outcome, cadence/fan-out, risk-adjusted, quality/direction, validation, artifact SHA>
CAUSAL/PARITY FINDING: <bounded evidence statement>
LIMITATIONS: <material limitations or none>
NEXT ACTION: <REPAIR_RECENT_DIRECTION|START_MICRO_FORWARD|MICRO_FORWARD_READY|FORWARD_BLOCKED|STOP_RESEARCH> — <bounded reason>
```

Also cite the immutable `tradejs-release-progress/v2` artifact. If it reports
`verdictAllowed=false`, do not emit this final shape yet; perform its next
action first.
