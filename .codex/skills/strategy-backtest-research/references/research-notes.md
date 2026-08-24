# TradeJS research note contract

Use this contract for every new internal research record, including strategy
backtests, deterministic AI-gate studies, ML experiments, audits, and
cross-strategy comparisons.

## Core research bundle linkage

When `yarn research:core` produced the evidence, record the `researchId`, spec
SHA-256, result/report/manifest paths and hashes, family hypothesis count,
Redis/export reconciliation, setup-identity fallback rate, and evidence matrix
in the immutable note. Record the explicit spec stage (`screen`,
`isolated_long`, or `confirmation`); never infer it from elapsed days or file
names. For later stages include parent research IDs and the family stage-index
lineage. Iterative `$strategy-improvement-research` child screens also include their direct
parent research IDs, round number, hashed causal-handoff payload, eligible
carried control, parent result hashes, mechanism verdict, predicted-versus-
observed trace/metric effect, remaining failure mode, and preregistered child
config deltas. The bundle does not replace the note: embed the full
resolved config and structured metrics needed for `reproduction: complete`
because `data/research` may be cleaned. Never copy a PASS label without target,
aggregate, and non-target verdicts separately.

Everything under `$PROJECT_CWD/notes/` in `TradeJS-Project` is local-only and
permanently ignored by Git. Never stage, commit, or force-add a research note. The local note is the durable
result record relative to export JSONL, Redis entries, backtest cache,
evaluation dumps, and `data/ai/output` reports, which are disposable inputs.
Deleting those inputs must not erase the exact configuration, lineage, or
reported aggregate metrics of a completed study from the local note.

## Storage and file boundaries

- Strategy-specific research lives at
  `notes/<Strategy>/YYYY-MM-DD-<short-kebab-slug>.md`. Use the exact strategy
  name exported by its package for the directory name.
- Repository-wide architecture and ML records live under `notes/Shared/`.
- One comparison whose question spans several strategies lives under
  `notes/CrossStrategy/`; do not duplicate it into every strategy directory.
- Do not put files directly under `notes/`.
- One research question, immutable dataset/run lineage, and decision belong to
  one file. A new export, run, hypothesis family, or decision gets a new file.
  Do not append dated entries to a rolling strategy log.
- Amend an existing file only to correct that same study or finish fields that
  were explicitly pending for the same immutable lineage.

## Required frontmatter

Every file starts with:

```yaml
---
schema: tradejs-research/v1
strategy: '<Strategy|Shared|CrossStrategy>'
date: 'YYYY-MM-DD'
kind: '<backtest|ai-gate|ml|architecture|runtime-parity>'
status: <implemented|observe|research-only|rollback|blocked|historical>
reproduction: <complete|partial|blocked|legacy-partial>
---
```

Use `reproduction: complete` only when the note contains every required item
below. Migrated historical records use `legacy-partial`; never fill missing
lineage from today's config or code.

## Required section order

```md
# <Strategy> — <research title>

## Research question

## Decision

## Reproduction manifest

## Resolved configuration

## Metrics snapshot (machine-readable)

## Reported metrics

## Findings

## Artifact inventory

## Limitations and next step
```

AI-gate records use the fixed report from
`../../ai-train-local-research/references/reporting.md` as their human-readable
`Reported metrics` block. They may append the audit and validation sections
required by that contract after the fixed tables.

## Reproduction manifest

Record values, not assumptions:

- strategy, research id, UTC execution time, and exact research question;
- merge id or backtest run id, shard count, row/trade count, minimum and maximum
  timestamps, data lag, ticker universe, timeframe, connector, and PnL unit;
- exact selection, skip/latest limits, terminal windows, partition boundaries,
  timestamp grouping, random seed, and capacity assumptions;
- exact commands, including every flag and referenced spec file;
- git SHA and dirty state plus gate, config-id, and context fingerprints when
  applicable;
- metric implementation/tool path and its git SHA when it can differ from the
  strategy lineage;
- effective `AI_MODE`, `MIN_AI_QUALITY`, entry delay, slippage, risk budget, and
  context-provider settings relevant to the result.

Do not record credentials or secret environment values.

## Resolved configuration

Embed the complete secret-free resolved configuration used by the run in a
fenced `json` block. A mutable Redis key, config name, current default, or file
path alone is not sufficient. Include at least the strategy/backtest config,
runtime overrides, risk fields such as `MAX_LOSS_VALUE`, and every context env
value that affects evaluated features.

If the runner provides an immutable archived resolved-config snapshot, embed
that snapshot and also record its run/test key and SHA-256. When the historical
config cannot be recovered, use `reproduction: partial` or `blocked` and write
`n/a`; never substitute a current config.

## Metrics snapshot

Embed the complete structured JSON summary produced by the authoritative tool,
without truncation, in a fenced `json` block. This is the machine-readable
source for the tables and preserves the reported metrics after exports or
caches are deleted.

- AI-gate baseline: use the full output of
  `yarn ai-train --localOnly --json -n 0` for the selected merge group.
- AI-gate comparisons: also embed structured baseline, pocket-only, final,
  partition, terminal-window, direction, concentration, capacity, and reject
  summaries produced by the permanent ablation tooling.
- Backtests: use
  `backtest-run-metrics.mjs --run <run-id> --json` and retain all requested
  terminal windows. Add raw sweep/result summaries when the decision depends
  on them.

The snapshot must contain the numbers needed to rebuild every human-readable
table in the note. Do not paste the deleted row-level export into Markdown. A
complete note preserves reported aggregate metrics and their provenance; it
does not claim to recreate arbitrary new row-level analyses after source data
is gone.

## Reported metrics and artifacts

- Keep stable metric names, window order, rounding, and `n/a` rules.
- Define `PnL/trade` as total PnL divided by completed trades. Never substitute
  the CLI progress `avg`, which is PnL per completed test/symbol; label that
  operational metric explicitly when it is retained. Use `n/a` when `N = 0`.
- For every core/backtest config and reported window, preserve and display
  three cohorts in fixed order: `ALL (aggregate portfolio)`, `LONG`, and
  `SHORT`. Each row must contain `N`, `PnL`, `PnL/trade`, `PF`, `WR`,
  `realized MaxDD`, and `cadence/day`. Define `N` as completed trades, `PnL` as
  summed net realized completed-trade PnL, `PF` as gross winning PnL divided by
  absolute gross losing PnL, `WR` as wins divided by `N`, `realized MaxDD` as
  the maximum peak-to-trough decline of the cohort's chronological
  completed-trade net-PnL equity curve, and `cadence/day` as `N / exact
calendar days`. Include zero-activity side cohorts rather than omitting them.
  Label LONG/SHORT drawdown as `side-only realized MaxDD`, computed from a
  time-ordered equity curve containing only that direction's completed trades.
  Label ALL drawdown as `aggregate portfolio realized MaxDD`; it remains a
  separate portfolio guardrail and is not interchangeable with side-only DD.
- Compute LONG and SHORT metrics after filtering the source rows by direction.
  Compute aggregate `PnL/trade` as
  `(LONG PnL + SHORT PnL) / (LONG N + SHORT N)`, never by averaging directional
  `PnL/trade` values. The machine-readable snapshot must retain the cohort and
  window dimensions needed to reproduce every row.
- Keep both directions enabled for raw-core evidence. A negative direction is
  reported, not silently disabled. State that AI-gate evaluation is a later,
  separate stage that examines the LONG and SHORT cohorts explicitly. Preserve
  a separate baseline/candidate assessment status for ALL, LONG, and SHORT;
  never use one aggregate status as the status of both side cohorts.
- A direction-targeted record must include its preregistered target side,
  unaffected side, matched control, metric thresholds, identity rule,
  rounding tolerance, possible occupancy interaction, non-target non-regression
  rule, and aggregate guardrails. Judge it primarily on preregistered
  target-side improvements in PnL, PnL/trade, PF, WR, and side-only realized
  MaxDD. Require exact non-target signal/trade identities and exact N plus PnL
  equality within only the documented reconciliation rounding tolerance only
  when the architecture makes that side invariant. Otherwise preserve explicit
  occupancy-spillover evidence: added/removed identities, N/cadence delta, and
  every economic-metric delta, then apply the preregistered non-regression
  rule. Report the target-side causal decision separately from the aggregate
  portfolio-promotion decision. Aggregate portfolio PnL and realized MaxDD are
  guardrails, not the sole acceptance or rejection criterion and not part of
  the target-side verdict.
- Define observed portfolio cadence as completed trades divided by exact
  calendar days. Do not divide full-universe cadence by symbol count. If a
  deliberately sampled universe is projected to a larger universe, retain
  both values and record tested symbols, target symbols, and the linear scale
  factor; never label the projection as observed cadence.
- For core robustness studies, retain terminal 365d/180d/90d/30d windows
  anchored to the immutable run end as half-open `[end - days, end)` intervals,
  including zero-activity windows. Record
  whether those windows came from a continuous long-run slice or standalone
  horizon runs with a reset and preload.
- If a broad grid was screened on a shorter all-universe window, label that
  stage selection-only, preserve every grid cell and its selection rule, and
  link the exact shortlisted cell to its later full long-window run. Never let
  the screening table stand in for the robustness table.
- Record whether parameter cells ran in one fan-out group or as isolated
  single-config runs. Long-window full-universe finalists should be isolated to
  bound heap use and prevent shared lifecycle state from crossing config cells.
  Record OOM/partial completion as a failed lineage and do not calculate
  strategy metrics from the completed subset.
- Record the run-manifest status at export time. An export made while the
  manifest is `running` is partial even when its captured rows are individually
  valid, so it cannot support PF, PnL/trade, portfolio MaxDD, direction, or
  terminal-window claims. Preserve chunks until a finished run reconciles.
- Record the frozen ordered ticker list and its checksum, eligible/raw counts,
  Redis snapshot timestamp, exact start/end timestamps, and missing/error test
  counts. In grid runs, keep every `configId` separate and embed the exact
  resolved config for each reported or rejected bucket.
- Record fingerprints, selection/calibration windows, and `effectiveFrom` for
  every external membership snapshot used by a detector. If a future/current
  registry or universe is applied to older decisions, set status and
  reproduction to `blocked`; preserve diagnostic metrics but do not describe
  them as point-in-time evidence or use them for parameter promotion.
- Preserve rejected hypotheses as immutable evidence with their causal claim,
  full config, exact run IDs, and structured metrics. Do not keep only the
  winning variant or a prose statement that a threshold was tried.
- Include zero-activity terminal windows rather than omitting them.
- Record checksums for every disposable input/output artifact when available.
- Artifact paths are an inventory, not the reproducibility source of truth.
- State any metric that cannot be recovered from the structured snapshot under
  `Limitations and next step` and lower the reproduction status accordingly.

## Historical migration

Historical split records retain their original body under a common v1
frontmatter and use `reproduction: legacy-partial`. Their
`source_content_sha256` verifies the pre-normalization source block. They use
the same required section spine, with the original headings demoted and body
preserved under `Reported metrics`. The original tables remain valid historical
evidence, but missing configs, fingerprints, or metric snapshots must stay
unknown.

After creating or editing notes, run:

```bash
node .codex/skills/strategy-backtest-research/scripts/research-notes-check.mjs
```
