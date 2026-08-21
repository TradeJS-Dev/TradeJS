# CLI Package Guide

## Scope

This file applies to `packages/cli` and supplements the repository-level
`../../AGENTS.md`.

## Local Rules

- Keep scripts as orchestration modules; put reusable computation and report
  construction under `src/lib` behind typed interfaces.
- Separate data loading, calculation, and presentation when they vary or can
  be tested independently. Preserve one small public seam for callers.
- Normalize untrusted CLI and environment input once. Pass typed contexts
  through internal modules instead of long argument lists or implicit globals.
- Keep business decisions in `core` or `node`; CLI owns command workflow,
  operational output, and adapters.
- Run backtests, replay, research, and runtime operations from
  `~/dev/tradejs/tradejs-project`, with this repository selected as the source
  root when required.
- Never stage `data/`, `notes/`, `output/`, credentials, or runtime evidence.

## Tests And Verification

- Test observable command/library seams; mock only process, filesystem,
  network, Redis, exchange, clock, and other true boundaries.
- Add branch coverage for flag combinations, empty evidence, truncation,
  failures, and output variants.
- Run focused Jest tests and `yarn workspace @tradejs/cli typecheck` while
  iterating.
- Before committing, run root `yarn prettify` and preferably `yarn checks`.
