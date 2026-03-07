---
title: ML Dataset Inspection
---

`yarn ml-inspect` helps validate dataset quality before training.

Source:

- `packages/cli/src/scripts/mlInspect.ts`

## Quick Start

```bash
yarn ml-inspect
yarn ml-inspect --strategy TrendLine --rows 20000 --mode sample
yarn ml-inspect --file data/ml/export/ml-dataset-trendline-merged-123.jsonl --mode tail
```

## Modes

- `head`: first N rows
- `tail`: last N rows
- `sample`: reservoir random sample

## Inspect Tools

- `quick` (default): built-in numeric diagnostics
- `ydata`: HTML profile report via Docker (`ml-profile`)

Examples:

```bash
yarn ml-inspect --tool quick --rows 15000
yarn ml-inspect --tool ydata --rows 20000 --mode sample
```

## What Quick Inspect Checks

For numeric fields it computes and flags:

- missing/non-finite rates
- near-constant features
- mostly-zero features
- outlier rate
- scale spread (`p99/median` and global scale mismatch)

It prints top problematic fields by score and recommended fixes.

## YData Output

`ydata` mode generates:

- `<dataset-name>.profile.html` next to source dataset

Requirements:

```bash
docker compose -f docker-compose.ml.yml build ml-profile
```

## Useful Flags

- `--dir data/ml/export`
- `--strategy <Strategy>`
- `--file <explicit path>`
- `--rows <N>`
- `--mode head|tail|sample`
- `--limitIssues <N>`
- `--minFieldValues <N>`
- `--tool quick|ydata`
