# Indicators Package Guide

## Scope

This file applies to `packages/indicators` and supplements the repository-level
`../../AGENTS.md`.

## Local Rules

- Keep indicators deterministic, strategy-neutral, and independent of
  connectors, storage, process state, and order execution.
- Preserve timestamp alignment, warmup behavior, nullability, and parity with
  any documented reference implementation.
- Put reusable geometry under its explicit subpath instead of coupling it to a
  single strategy.
- Register new indicators through the package registry and expose them only
  through intentional package entries.

## Tests And Verification

- Cover warmup, empty/short input, alignment, numerical edge cases, and known
  reference vectors.
- Run focused tests, `yarn workspace @tradejs/indicators typecheck`, and
  `yarn workspace @tradejs/indicators build`.
- Before committing, run root `yarn prettify` and preferably `yarn checks`.
