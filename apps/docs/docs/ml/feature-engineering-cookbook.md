---
title: Feature Engineering Cookbook
---

Use this checklist when adding or changing ML features.

## Design Rules

- Prefer causality-safe features only.
- Keep naming conventions consistent (`TF*_ALT_*`, `TF*_BTC_*`).
- Avoid leaking future information through timestamp alignment.

## Train/Infer Parity

- Ensure feature trimming and windows match inference path.
- Keep schema changes backward-compatible only when needed.
- Add tests for transformed output shape.

## Practical Workflow

1. Add feature in transform path.
2. Regenerate dataset export.
3. Train model and inspect holdout/walk-forward quality.
4. Verify inference still loads and predicts with new feature set.
5. Document feature intent and impact.

## Anti-Patterns

- Adding highly unstable features without drift monitoring.
- Mixing experiment-only features into production path silently.
