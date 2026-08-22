# Infrastructure Package Guide

## Scope

This file applies to `packages/infra` and supplements the repository-level
`../../AGENTS.md`.

## Local Rules

- Keep this package focused on storage, network, filesystem, logging, ML, and
  other infrastructure adapters.
- Domain contracts come from `@tradejs/types`; reusable business calculations
  belong in `core` or `node`, not in persistence commands.
- Preserve explicit subpath exports and never require consumers to deep-import
  `src` internals.
- Keep Redis namespaces, evidence schemas, and Timescale writes compatible with
  the ownership rules in the root guide.
- Batch Timescale writes below PostgreSQL bind-parameter limits and keep schema
  setup idempotent.

## Tests And Verification

- Mock or substitute true infrastructure boundaries; test serialization,
  retries, batching, validation, and failure behavior explicitly.
- Run focused tests, `yarn workspace @tradejs/infra typecheck`, and
  `yarn workspace @tradejs/infra build`.
- Before committing, run root `yarn prettify` and preferably `yarn checks`.
