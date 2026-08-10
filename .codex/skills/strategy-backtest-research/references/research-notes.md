# TradeJS research note contract

Use this contract for every new internal research record, including strategy
backtests, deterministic AI-gate studies, ML experiments, audits, and
cross-strategy comparisons.

Everything under `notes/` is local-only and permanently ignored by Git. Never
stage, commit, or force-add a research note. The local note is the durable
result record relative to export JSONL, Redis entries, backtest cache,
evaluation dumps, and `data/ai/output` reports, which are disposable inputs.
Deleting those inputs must not erase the exact configuration, lineage, or
reported aggregate metrics of a completed study from the local note.

## Storage and file boundaries

- Strategy-specific research lives at
  `notes/<Strategy>/YYYY-MM-DD-<short-kebab-slug>.md`. Use the exact strategy
  directory name from `packages/strategies/src`.
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
strategy: "<Strategy|Shared|CrossStrategy>"
date: "YYYY-MM-DD"
kind: "<backtest|ai-gate|ml|architecture|runtime-parity>"
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
