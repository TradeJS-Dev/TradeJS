# ML Package Guide

## Scope

This file applies to `packages/ml` and supplements the repository-level
`../../AGENTS.md`.

## Local Rules

- This private package owns Python inference/training helpers and Docker build
  assets, not strategy gate policy or research conclusions.
- Keep training and inference feature shapes causally aligned with the
  TypeScript export/runtime pipeline.
- Do not hand-edit generated protobuf modules unless the source schema and
  generation workflow are updated together.
- Keep secrets, datasets, models, and local training output out of Git.
- Strategy-specific deterministic gates remain in their standalone strategy
  repositories.

## Verification

- Run focused Python checks appropriate to the changed module and
  `yarn workspace @tradejs/ml build`.
- For feature-shape changes, also run the relevant TypeScript ML/export tests
  from the repository root.
- Before committing, run root `yarn prettify` and preferably `yarn checks`.
