---
name: strategy-backtest-research
description: Execute a scoped TradeJS strategy implementation or preregistered core-backtest experiment, including StrategyAPI checks, figures, Redis configs, cache-only runs, metric reconciliation, and AI export preparation. Use strategy-improvement-research instead to choose hypothesis families or orchestrate a multi-round candidate lineage.
---

# Strategy Backtest Research

Run operational research commands from `TradeJS-Project`, with `PROJECT_CWD`
as the artifact/config root and `TRADEJS_SOURCE_REPOSITORY_ROOT` as the Git and
build lineage root. Store `data/` and ignored `notes/` only under the project
root.

When research will apply and compare alternative strategy source edits, create
one dedicated worktree from the frozen baseline SHA for that immutable lineage.
Keep the canonical strategy checkout clean, point
`TRADEJS_SOURCE_REPOSITORY_ROOT` at the worktree, and run source checks there.
Pure config, artifact, reporting, or read-only backtest work does not require a
worktree. Before replacing a rejected source candidate, preserve its exact diff,
build hash, resolved config, and run outcome in Project-owned evidence; restore
only the disposable worktree. Commit only a selected candidate, and remove a
no-winner worktree only after evidence is frozen. A worktree does not isolate a
temporary package overlay in `TradeJS-Project/node_modules`, which must be
restored separately to the verified stable package.

Use this skill when working on strategy implementation, figures, backtest
configuration, or one already-preregistered core experiment in the owning
standalone strategy repository.

This is an execution skill, not the end-to-end improvement orchestrator. It
does not invent a multi-round research budget, choose competing hypothesis
families, rank the global candidate ledger, or freeze the final composition.
Use `$strategy-improvement-research` for those decisions. Do not use this skill
for general `ai-train --localOnly` gate research; use
`$ai-train-local-research` for a frozen core/export.

## Strategy Shape

- `core.ts` must use `StrategyAPI`; do not call AI/ML providers or order placement directly.
- Geometry-based strategies should keep visual artifacts in the strategy package.
- `figures.ts` should include the lines/points needed to inspect why a trade happened.
- `adapters/ai.ts` should carry strategy-specific context into the AI payload when backtest exports need AI context, but local gate tuning belongs to `ai-train-local-research`.

## DoubleTap Notes

When the strategy is `DoubleTap`, `engine.ts` ports the Bjorgum Double Tap pattern mechanics:

- maintain swing pivots from rolling highest/lowest windows
- detect double bottom on close above neckline
- detect double top on close below neckline
- derive target from `DOUBLETAP_TARGET_FIB_PCT`
- derive stop from invalidation pivot and `DOUBLETAP_STOP_FIB_PCT`
- `figures.ts` is required. Include pattern zig-zag, neckline, target, stop, pivot points, and entry marker.

## Backtest Workflow

1. Prepare or update Redis backtest config under `users:root:backtests:configs:<Strategy>:<name>`.
   - When a research config includes `MAX_LOSS_VALUE`, set it to `10`.
   - When updating a backtest `:ai` config, enable both `LONG` and `SHORT`; let the AI gate disable a side later if needed.
2. Start with small cache-only runs: `yarn backtest -c <Strategy>:<name> -d 30 --cacheOnly --fast`.
3. Tune strategy-specific grid fields first.

When a symmetric candidate loses in aggregate but its reconciled LONG/SHORT
attribution shows a material improvement on only one side, do not discard or
globally enable it automatically. Register a new direction-specific follow-up
with explicit `_LONG` and `_SHORT` fields, keep both directions enabled, and
screen the combined policy against the same control. The follow-up is a new
hypothesis lineage; preserve the rejected symmetric run and preregister the
directional rule before testing it.

For DoubleTap, prioritize:

- `DOUBLETAP_PIVOT_LENGTH`
- `DOUBLETAP_PIVOT_TOLERANCE_PCT`
- `DOUBLETAP_TARGET_FIB_PCT`
- `DOUBLETAP_STOP_FIB_PCT`
- `DOUBLETAP_MIN_PATTERN_HEIGHT_PCT`
- `DOUBLETAP_MAX_BREAKOUT_DISTANCE_PCT`
- side `minRiskRatio`

4. Once a config is stable across 20+ tickers on `-d 30`, use it for year-scale `--ai` exports. Analyze exported local AI gate behavior with `ai-train-local-research`.

For detailed metrics from a non-`--fast` backtest run, use:

```bash
yarn node -r dotenv/config .codex/skills/strategy-backtest-research/scripts/backtest-run-metrics.mjs --run <run-id> --json
```

The report reconstructs completed trades from cached order artifacts and shows
full/365d/180d/90d/30d/7d metrics where applicable, including PF, drawdown, strict
loss, loss streak, losing months, cadence, and scale-in levels 2/3/4. Use a
matching no-scale-in run to separate sizing effects from scale-in effects.

For portfolio metrics from a `--fast --ai` core export, use the completed-trade
JSONL instead of treating the per-symbol Redis drawdown as portfolio MaxDD:

```bash
yarn node -r dotenv/config .codex/skills/strategy-backtest-research/scripts/fast-ai-export-metrics.mjs \
  --file <merged-export.jsonl> --run <run-id> --json
```

`--file` may be repeated for disjoint export shards. If the Redis run manifest
is unavailable, pass its frozen end explicitly with `--end <epoch-ms|ISO>`.
The default core-screen terminal matrix is `1100d/365d/180d/90d/30d`, anchored strictly to
that manifest end rather than the newest export row. Windows are half-open
`[manifestEnd - days, manifestEnd)`, matching the backtest manifest. The report uses only
`tradeResult.netProfit`, `tradeResult.exitTimestamp`, direction, symbol, and
signal identity; it never consumes AI/LLM/gate decisions. It reports N/W/L,
WR, PF, PnL, PnL/trade, deterministic portfolio MaxDD, exact calendar-day
observed cadence, and LONG/SHORT breakdowns. With `--run`, it filters rows to
that run and separately reconciles export N/W/L/PnL against Redis
`result.stat`; Redis cannot supply export PF or portfolio MaxDD. Once N/W/L
and PnL reconcile within the documented per-symbol rounding tolerance, use the
row-level export as the authoritative trade-economic total instead of swapping
in the cent-rounded Redis aggregate.

For every `$strategy-improvement-research` final composition, extend the same permanent report
to `1095d/1460d/1825d-or-exact-maximum/365d/180d/90d/30d/7d`. When cached
coverage is shorter than 1825 days, report the exact covered duration (for
example 1800d) and do not label it a complete five-year window. Reuse this
tool's full ALL/LONG/SHORT statistics; do not replace them with a compact custom
parser. The improvement workflow then builds one independently verified
deterministic gate on each exact core export, including the baseline export, and
compares only the resulting `core + own gate` compositions. Raw-core metrics
remain diagnostic and must never be mixed into the final-composition chart.

## Required Core Metric Cohorts

For every reported config and full or terminal window, present one table with
these rows in fixed order:

1. `ALL (aggregate portfolio)`
2. `LONG`
3. `SHORT`

Every row must contain `N`, `PnL`, `PnL/trade`, `PF`, `WR`, `realized MaxDD`,
and `cadence/day`. Use these definitions consistently:

- `N`: completed trades in the cohort.
- `PnL`: sum of completed-trade net realized PnL.
- `PnL/trade`: `PnL / N`, or `n/a` for `N = 0`.
- `PF`: gross winning PnL divided by absolute gross losing PnL.
- `WR`: winning completed trades divided by `N`.
- `realized MaxDD`: maximum peak-to-trough decline of the chronological
  completed-trade net-PnL equity curve for that cohort and window. Label LONG
  and SHORT values `side-only realized MaxDD` because each equity curve
  contains only that direction's trades; label ALL as `aggregate portfolio
realized MaxDD`.
- `cadence/day`: cohort `N / exact calendar days` in the reported window.

Filter rows to LONG or SHORT before computing side metrics. Compute aggregate
`PnL/trade` as `(LONG PnL + SHORT PnL) / (LONG N + SHORT N)`; never average the
side `PnL/trade` values. Keep both directions enabled in raw-core configs even
when one is negative, and never omit the weak cohort from a table. AI-gate
research happens later and evaluates LONG and SHORT cohorts explicitly. Record
the baseline/candidate assessment status independently for ALL, LONG, and
SHORT; an aggregate label is not a directional label.

For a direction-targeted hypothesis, preregister the target direction, the
unaffected direction, matched control, metric thresholds, identity comparison,
rounding tolerance, possible shared-position occupancy path, non-target
non-regression rule, and aggregate portfolio guardrails. Judge the causal
hypothesis primarily on the target cohort. Require that cohort to satisfy the
preregistered improvements in PnL, PnL/trade, PF, WR, and side-only realized
MaxDD, with lower drawdown being better. Require exact signal/trade identities,
exact N, and PnL equality within only the documented reconciliation-rounding
tolerance on the non-target side only when the architecture makes it invariant.
If shared position occupancy, cooldown, order lifecycle, or another interaction
can affect it, report occupancy spillover explicitly: added and removed trade
identities, N/cadence delta, and PnL, PnL/trade, PF, WR, and side-only MaxDD
deltas. Apply the preregistered non-regression rule to that evidence. Report the
target-side causal verdict and the aggregate portfolio-promotion verdict
separately. Aggregate portfolio PnL and aggregate portfolio realized MaxDD are
guardrails, not substitutes for the target-side verdict.

For full-universe core robustness research:

1. Freeze the ordered eligible ticker list and checksum, exact UTC start/end,
   resolved config grids, git/dirty lineage, connector, interval, fees,
   slippage, and entry delay before comparing strategies or variants.
   Audit every non-candle membership input (wallet registry, top-symbol/perp
   universe, benchmark basket, allowlist) too. Resolve an effective-dated
   version at or before each decision timestamp. If only a later/current
   snapshot exists, label the long-window study blocked for point-in-time
   robustness and do not optimize from it.
2. Use observed portfolio cadence = completed trades / exact calendar days.
   Do not divide a full-universe cadence by symbol count or extrapolate it to an
   approximate exchange count. If the experiment intentionally samples the
   universe, show any linear projection separately with both universe sizes.
3. For a wide parameter family, first use a clearly labelled all-universe
   180d screening grid, then rerun only shortlisted cells on one continuous
   long window. A short screen is selection evidence, never robustness
   evidence. Report terminal 365d/180d/90d/30d slices from the long run,
   anchored to its immutable manifest end as half-open intervals, including
   zero-activity slices. At
   a 0.2/day floor, require at least 220/73/36/18/6 completed trades on
   1100/365/180/90/30d respectively.
4. Keep each grid `configId` separate and require identical planned/completed
   symbol counts. Never add metrics from several parameter buckets together.
   Run shortlisted long-window cells as isolated single-config runs. Avoid a
   multi-cell 1100d full-universe fan-out: it increases peak heap use and may
   contaminate lifecycle/execution state when a strategy's shared-state key
   does not cover the full resolved config. Use a multi-cell 180d screen only
   after an explicit state-isolation test; otherwise split that screen too.
   An OOM or partial manifest is a failed experiment, not a smaller sample.
   Parallelism is a host-wide budget: count tester workers from every active
   run and inspect memory pressure/swap before launching another batch. If two
   batches already sustain pressure, wait or reduce `-p`; a per-worker heap cap
   does not make a third batch safe.
5. Confirm shortlisted variants without `--fast`. For stateful strategies,
   also run standalone shorter horizons to measure reset/preload sensitivity;
   a terminal slice and a cold-start horizon answer different questions.
6. Save rejected as well as accepted hypotheses with the causal claim, full
   resolved config, exact runs, structured metrics, and artifact checksums.
   Do not repeat an old threshold sweep without a new causal rationale.
   If a rejected symmetric lifecycle improves only LONG or only SHORT, record
   that attribution and test at most one preregistered `_LONG`/`_SHORT`
   follow-up with both directions still enabled before abandoning the family.

Use two explicit outcome labels. `Strictly robust` requires non-negative PnL,
PF >= 1, and the requested cadence floor in the full run and every required
terminal window. `Improved research candidate` is allowed for a still-negative
core only when full-window PnL and PnL/trade improve against the frozen control,
cadence survives every required window, and all terminal PnL/PF/MaxDD
regressions are disclosed. An aggregate win cannot hide a collapsed tail.

The `--ai` flag on a BACKTEST run may be used only as raw completed-core-trade
transport for the terminal metric tool: BACKTEST entry policy bypasses AI
quality. State this explicitly so the result is never mistaken for an AI-gated
backtest.

Treat row-level economics as acceptance-grade only when every config bucket
has a complete manifest, exact Redis N/W/L reconciliation, and only the allowed
per-symbol rounding delta in PnL. A missing row or conflicting duplicate makes
that bucket's PF, PnL/trade, terminal windows, and portfolio MaxDD invalid.
Never fill the gap from aggregate stats; repair the capture/export path and
rerun the affected cell.

Do not invoke `ai-export` while the selected run manifest is `running`, whether
the run id is explicit or found through latest-run discovery. Workers may still
own open append streams. The exporter must retain chunks by default and reject
active runs; cleanup is a separate post-run operation after reconciliation.

For all backtest summaries, calculate and report average trade PnL as
`total PnL / completed trades` and label it `PnL/trade`. The live CLI progress
`avg` is PnL per completed test/symbol, not PnL/trade; do not use it as a trade
quality metric. If it is useful operationally, label it `PnL/test` or
`PnL/symbol`. Report `PnL/trade` as `n/a` when `N = 0`.

For every AI export handed to gate research, record the merge id, shard count,
minimum and maximum timestamps, backtest config ids, git SHA, and the context env
used to construct derivatives/CMC inputs. A year-scale export without a fresh
terminal tail is suitable for historical research but not for a current live
cadence claim.

## Core experiment execution

For every new core control-versus-candidate experiment, use the versioned
contour in `CORE_RESEARCH.md`:

1. Create and edit a spec with `yarn research:core init ...`.
2. Freeze the causal claim, family, target direction, ordered universe hash,
   full resolved configs plus their canonical hashes, window, execution model,
   variants, selection rules, and explicit
   stage (`screen`, `isolated_long`, or `confirmation`) before runs. Never
   infer the stage from period length or the presence of a run ID. Later stages
   must name `parentResearchIds`; regenerate the family stage index.
3. Run `prepare`, then `analyze` completed exports or `run` explicit isolated
   commands. Never discover a mutable latest run implicitly.
4. Require completed-manifest/full-checkpoint/one-config reconciliation.
   Inspect setup matching, ALL/LONG/SHORT, terminal/fold/month/regime matrices,
   cluster bootstrap, family-aware Holm, DSR/PBO diagnostics, and cost stress.
5. Run `verify` before the immutable note. Link bundle hashes, while still
   embedding the complete resolved config and structured metrics required by
   the note schema.

When `$strategy-improvement-research` invokes this skill, execute only the
preregistered experiment and return its reconciled evidence. The orchestrator
owns parent/child selection, research-budget accounting, belief updates, and
the decision to run another candidate.

After changing the contour itself, use its public test seam:

```bash
yarn research:core:test
yarn research:core:coverage
```

The coverage command enforces the checked-in floor. Test observable immutable
specs/results/artifacts and selection decisions; mock only Redis, child-process,
time/randomness, or filesystem boundaries. Do not mock internal metric,
comparison, or statistics modules. Preserve single-pass streaming JSONL ingest,
stable non-empty trade identities, one semantic threshold evaluator across full/
terminal/cost-stress windows, unconditional terminal cadence floors, and bounded
SVG rendering. Visual downsampling must never alter full-resolution metrics,
matching, reconciliation, or `trades.jsonl`.

Reuse already chronological trades instead of sorting each cohort/window again,
group regimes in one pass, and stream normalized trade/match artifacts with
backpressure. Do not build one export-sized output string in memory.

Bootstrap the complete immutable calendar window, including zero-trade
clusters; do not sample only active clusters. Report CSCV/PBO as unavailable
when fold vectors are identical and there is no meaningful model ranking.

Use `--researchTrace` only when the question needs the setup/entry/skip funnel.
It writes compact events plus per-test skip summaries and adds deterministic
setup identity to AI rows; keep it off when completed trades answer the question.

Before writing research results, read `references/research-notes.md` and follow
it exactly.

- Store strategy research at
  `notes/<Strategy>/YYYY-MM-DD-<short-kebab-slug>.md`.
- Keep `notes/` local-only. Never stage, commit, or force-add its contents; the
  directory must remain ignored by Git.
- Create one file per research question and immutable run/export lineage. Never
  append another dated study to an existing rolling notes file.
- Put repository-wide work in `notes/Shared/` and genuine multi-strategy
  comparisons in `notes/CrossStrategy/`; never place files directly in
  `notes/`.
- Embed the complete secret-free resolved config and the authoritative
  structured metrics JSON. Paths to Redis, cached orders, exports, or output
  reports are not enough because those artifacts may be deleted.
- Use `reproduction: complete` only when the note alone preserves every
  reported aggregate metric and its lineage. Mark missing historical evidence
  `partial` or `blocked`; never reconstruct it from current defaults.
- Run
  `node .codex/skills/strategy-backtest-research/scripts/research-notes-check.mjs`
  after creating or editing research records.

## Validation

- Run the affected strategy tests after strategy edits, for example `yarn jest packages/strategies/src/<StrategyName> --runInBand`.
- Run `yarn prettify` before broader verification.
- Run `yarn checks` before final handoff when practical.
