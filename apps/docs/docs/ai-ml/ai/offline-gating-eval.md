---
title: Offline Evaluation for AI Gating
---

Before changing AI gating logic, run offline evaluation.

## Goal

Estimate how AI approval rules affect trade coverage and expected quality without touching live execution.

## Dataset

- Historical signals with known outcomes.
- Stored AI outputs (or reproducible prompt replay).
- Strategy metadata (symbol, direction, timeframe).

## Reproducible CLI Flow

```bash
npx @tradejs/cli backtest --config TrendLine:base --ai
npx @tradejs/cli ai-export
npx @tradejs/cli ai-train -n 50 --minQuality 4
```

Artifacts:

- `backtest --ai` writes `data/ai/export/ai-dataset-<strategy>-chunk-<chunkId>.jsonl`
- `ai-export` merges them into `data/ai/export/ai-dataset-<strategy>-merged-<timestamp>.jsonl`
- `ai-train` replays saved prompts from the latest merged file by default

Useful `ai-train` flags:

- `-n, --recent` evaluate the latest N trades from the end (`0` = all rows)
- `--minQuality` minimum AI quality threshold required to approve entry
- `-s, --strategy` pick the latest merged file for one strategy
- `-f, --file` replay a specific merged dataset file

Approval rule used by `ai-train`:

- trade is approved only when AI returns the same direction as the original signal and `quality >= minQuality`
- offline correctness is measured against realized trade outcome (`profit > 0`)

## Core Metrics

- Approval rate
- Precision by quality bucket
- Impact on net expectancy proxy
- Disagreement rate with strategy direction
- `tp / fp / tn / fn` counts for approval vs realized profitability

## Evaluation Flow

1. Run baseline policy on historical sample.
2. Run candidate policy.
3. Compare coverage vs quality tradeoff.
4. Approve only if tradeoff improves and remains stable.

## Deployment Rule

Promote policy changes gradually and monitor live drift after release.
