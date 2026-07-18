# AI Gate Ablation Tool

Use `scripts/ai-gate-ablation.mjs` for repeatable deterministic gate hypothesis
checks. It streams every shard in a merged export, reconstructs the current AI
payload and local gate, and evaluates causal feature expressions without using
trade outcome fields as inputs.

## Prerequisite

Build the runtime packages after adapter or gate changes:

```bash
yarn workspace @tradejs/strategies build
yarn workspace @tradejs/node build
yarn workspace @tradejs/cli build
```

`yarn ai-train --localOnly --json -n 0` remains the baseline authority. Before
interpreting a candidate, compare the tool's baseline qN+ support, PnL, PF,
max drawdown, strict loss, and loss streak with the matching `ai-train` run.

## Dataset Discovery

List all merged groups or only one strategy:

```bash
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs --list
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs --list --strategy LiquidityTails
```

`--strategy` selects the latest matching merge. `--file` accepts any shard and
automatically resolves all sibling shards with the same strategy token and
merge id.

## Variants

Pass each hypothesis as:

```text
name::mode[@quality]::expression
```

Modes:

- `filter`: keep current qN+ approvals that match the expression.
- `exclude`: keep current qN+ approvals that do not match the expression.
- `add`: keep baseline approvals and add matching rejected rows at the optional
  assigned quality.
- `replace`: ignore the current gate and approve only matching rows at the
  optional assigned quality.

When `@quality` is omitted, `add` and `replace` use `--minQuality`.

Example:

```bash
node .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.mjs \
  --file data/ai/export/ai-dataset-liquiditytails-merged-1784296244106-part1.jsonl \
  --variant 'near-ma-and-zone::filter::additionalIndicators.baseContext.regime.trend.priceDistanceToMaSlowAtr <= 1.2 && additionalIndicators.baseContext.structure.liquidityZones.activeCount >= 1' \
  --featurePattern 'priceDistanceToMaSlowAtr|liquidityZones.activeCount' \
  --output data/ai/output/liquiditytails-near-ma-and-zone.md
```

Repeat `--variant` to compare several rules in one dataset pass. For a reusable
set, pass `--spec path/to/variants.json`:

```json
{
  "variants": [
    {
      "name": "body-065",
      "mode": "filter",
      "expression": "additionalIndicators.baseContext.regime.momentum.bodyStrength >= 0.65"
    },
    {
      "name": "q3-recovery",
      "mode": "add",
      "quality": 4,
      "expression": "additionalIndicators.liquidityTailsContext.oldP2CorrelationDirection == LONG"
    }
  ]
}
```

## Expression Grammar

Expressions support parentheses, `&&`, `||`, and comparisons:

```text
<=  >=  <  >  ==  !=
```

Values can be numbers, booleans, `null`, quoted strings, or unquoted enum-like
strings such as `LONG`, `high`, and `aligned`. Missing features never match a
predicate, including `!=`; test availability separately through the feature
inventory instead of treating missing data as approval evidence.

Use `--featurePattern '<regex>'` to print matching causal paths, availability,
ranges, and categories. Do not use `--includeGateContext` for discovery; it is
only for auditing current gate output fields.

## Report Contract

Every report contains:

- baseline and candidate tables for full history, `180d`, `90d`, `30d`, `7d`;
- q3+/q4+/q5+ summaries, configurable with `--qualityThresholds`;
- time-ordered train/trailing-validation split;
- direction and monthly stability;
- matched, removed, and added slices;
- PnL, winrate, PF, max drawdown, DD ratios, strict loss, max loss streak,
  losing months, cadence, and symbol concentration.

The JSON report also carries average trade, payoff ratio, recovery factor,
ulcer index, profit per day/month, and cadence per week. Use `--json` or an
`.json` output path when downstream analysis needs those fields.

## Maintenance Rule

Do not create another `/tmp` parser, heredoc ESM replay, or strategy-specific
one-off script for capabilities that belong here. Extend this script and its
`node:test` coverage, then update this reference and `SKILL.md` when the
research contract changes.

Run the tool tests after every change:

```bash
node --test .codex/skills/ai-train-local-research/scripts/ai-gate-ablation.test.mjs
```
