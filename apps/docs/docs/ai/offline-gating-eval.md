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

## Core Metrics

- Approval rate
- Precision by quality bucket
- Impact on net expectancy proxy
- Disagreement rate with strategy direction

## Evaluation Flow

1. Run baseline policy on historical sample.
2. Run candidate policy.
3. Compare coverage vs quality tradeoff.
4. Approve only if tradeoff improves and remains stable.

## Deployment Rule

Promote policy changes gradually and monitor live drift after release.
