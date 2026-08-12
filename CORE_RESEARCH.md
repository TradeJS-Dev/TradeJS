# Core strategy research

`yarn research:core` is the internal preregistered pipeline for
control-versus-candidate strategy experiments. It accepts completed AI JSONL
exports or runs explicit backtest commands, then writes an immutable bundle to
`data/research/core/<researchId>/`.

Backtest `--ai` is raw completed-core-trade transport; it does not enable or
tune the AI gate. Keep LONG and SHORT enabled in raw-core configs. The contour
reports ALL, LONG, and SHORT separately so a weak side stays visible and can be
handled later by AI-gate research.

## Commands

Create a versioned draft, then edit its causal claim and frozen inputs. Replace
each empty `variants[].resolvedConfig` and recompute its canonical
`configSha256`; strict validation intentionally rejects the draft until this is
done:

```bash
yarn research:core init \
  --out data/research/specs/my-hypothesis.json \
  --researchId my-strategy-family-v1 \
  --strategy MyStrategy \
  --start 1691452800000 \
  --end 1786492800000 \
  --symbolsFile data/research/frozen-symbols.json
```

Every spec declares `stage: screen | isolated_long | confirmation`. The
evidence matrix derives stage evidence from that explicit field; elapsed days
or the mere presence of run IDs never upgrades a screen into long-run evidence.
Later stages also require `parentResearchIds`. The generated root `index.json`
validates parent existence/family continuity and shows the full
screen→isolated-long→confirmation history, including rejected branches.
Preparation also requires the later-stage candidate to retain the canonical
config SHA of a candidate that passed its direct parent stage.

`$strategy-release` may also chain several immutable `stage=screen` specs in
one hypothesis family. Such a child screen names direct `parentResearchIds` in
the spec and lineage; the stage index validates that the parent exists and stays
inside the family. Before the child is frozen, its parent analysis must be
complete and summarized in a hashed causal handoff containing the carried
eligible control, mechanism verdict, predicted-versus-observed metric/trace
effect, and exact next config deltas. A failed candidate may motivate a child
but cannot become its control. Release mode allocates one anchor plus two
round-2 and two round-3 candidates per surviving family, never more than five
candidate hypotheses in the cumulative family ledger.

```bash
yarn research:core prepare --spec data/research/specs/my-hypothesis.json
yarn research:core analyze --spec data/research/specs/my-hypothesis.json
yarn research:core verify --spec data/research/specs/my-hypothesis.json
yarn research:core index --root data/research/core
```

`analyze` reads `variants[].files`. A variant may instead define an explicit
`command` string array. `run` executes such variants sequentially, captures the
run ID, calls explicit `ai-export --runId ... --keepChunks`, and analyzes the
resolved files:

```bash
yarn research:core run --spec data/research/specs/my-hypothesis.json
```

Backtest commands must include exact start/end, frozen ticker CSV, one isolated
config, `--ai --fast --cacheOnly`, and host-safe parallelism. Add
`--researchTrace` only when setup/entry/skip attribution is required.

## Artifact contract

The research directory contains canonical `spec.json`, hashed `manifest.json`,
complete `result.json`, causal `comparison.json`, row-level `matches.csv`, all
window-selected normalized trades in `trades.jsonl`, a self-contained
`report.html`, and exact `runs/*.log` for orchestrated runs. Thus metric and
matching reconstruction does not depend on keeping mutable AI exports.

`data/research/core/trials.jsonl` is an append-only hash-chained family ledger.
It retains rejected candidates and supplies the family denominator for Holm
correction. `verify` checks every artifact hash and the full ledger chain.

The spec itself embeds every full secret-free resolved config and its canonical
SHA; mutable Redis names are inventory only. Completed run IDs require a
completed Redis manifest, full checkpoint count,
one isolated config ID, the exact frozen window/universe/strategy/connector/
interval, raw `--ai` transport, exact export-versus-Redis N/W/L, and PnL within
the documented per-symbol cent-rounding tolerance. A mismatch invalidates
selection.

## Metrics and causality

- Fixed cohort order: ALL, LONG, SHORT.
- PnL/trade: cohort PnL divided by cohort completed positions.
- ALL MaxDD: time-ordered aggregate portfolio realized drawdown.
- LONG/SHORT MaxDD: time-ordered side-only realized drawdown.
- Cadence: cohort completed positions divided by exact calendar days.
- Tail/payoff profile: average win/loss, payoff ratio, median/P05/P95 trade,
  median holding hours, and maximum consecutive losses for every cohort/window.
- Regimes use only signal-time
  `payload.additionalIndicators.baseContext`, never outcome fields.
- Setup matching uses explicit research identity, strategy setup/pattern ID,
  then deterministic strategy/symbol/direction/signal-time fallback. The
  fallback rate is reported.
- Cost stress subtracts extra round-trip bps from entry notional.
- Fold trade floors, terminal cadence-derived trade floors, and optional
  `costStressRules` are executable selection guardrails, not report-only rows.
- Statistical diagnostics include calendar-cluster bootstrap, family-aware
  Holm, deflated-Sharpe diagnostics, and CSCV/PBO when data is sufficient.

The calendar-cluster bootstrap preregisters the immutable window and includes
zero-activity calendar clusters; it does not condition inference only on days
where a trade happened. CSCV/PBO is reported as unavailable when variants have
identical fold performance because there is no meaningful selection ranking.

Terminal slices, equal-time folds, months, regimes, and cost stress derive from
one immutable long export. Cold-start/reset, delay stress, non-fast confirmation,
and runtime parity are separate evidence. Attach their files through optional
variant fields; missing stages remain `missing` in the evidence matrix.

## Trace semantics

`yarn backtest ... --researchTrace` writes compact `signal_emitted` or
`entry_rejected`, `entry_executed`, `position_exited`, and one per-test
`skip_summary`. It does not log every candle. Completed AI rows also carry a
deterministic setup identity. Trace summaries remain in Redis checkpoint rows
even when trace JSONL is later removed.

For release iterations, trace capture is mandatory: the next variants must cite
the observed signal/rejection/execution/exit or skip-summary transition they
intend to change. Trace alone is not economic evidence; pair it with the fixed
ALL/LONG/SHORT metrics and stable setup-identity matched/added/removed cohorts.

A passing report is not production promotion. Promotion still requires the
preregistered screen, isolated long run, terminals, cold-start sensitivity for
stateful strategies, cost/delay stress, non-fast confirmation, and parity where
applicable.

## Verification and performance contract

Run the contour's public-seam unit suite after changing its spec, dataset,
metric, comparison, statistics, reconciliation, trace, report, or orchestration
modules:

```bash
yarn research:core:test
yarn research:core:coverage
```

The coverage command is a regression gate for the contour plus its Node setup
identity and infra trace adapters. It currently requires at least 85% statements,
70% branches, 90% functions, and 87% lines. Do not increase coverage by mocking
internal collaborators or asserting implementation call order. Test observable
experiment artifacts and decisions through the public research seam; mock only
Redis, process execution, time/randomness, or the filesystem where they form a
true system boundary.

Dataset ingest parses and hashes each source JSONL in one streaming pass. It
retains normalized completed trades because causal matching, portfolio ordering,
statistics, and the durable normalized trade archive require them, but it does
not retain raw dataset rows. A completed row without a stable `signalId` is an
error rather than an ambiguous dedupe identity.

Chronological metric calls reuse already ordered exports and sort only when an
input is actually out of order. Regime grouping is one pass, and normalized
trade/match artifacts are written with stream backpressure instead of building
one export-sized string in memory.

`report.html` is diagnostic, not an authoritative metric store. To keep large
reports bounded, each SVG curve is deterministically reduced to at most 1,200
points while preserving its first/last point and local extrema. `result.json`
and `trades.jsonl` remain full-resolution. Stage-index generation scans each
experiment spec once and reuses the validated family mapping.
