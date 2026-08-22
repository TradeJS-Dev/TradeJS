# Node Runtime Package Guide

## Scope

This file applies to `packages/node` and supplements the repository-level
`../../AGENTS.md`.

## Local Rules

- Own Node-only runtime behavior: plugin loading, strategy execution,
  backtesting, registries, runtime composition, and server-side adapters.
- Keep browser-safe calculations and authoring helpers in `core`; keep storage
  implementations in `infra`; keep command orchestration in `cli`.
- Import other packages only through their public subpaths. Do not deep-import
  package source.
- Keep detector engines pure and replayable; position policy, StrategyAPI side
  effects, hooks, and execution belong at explicit runtime seams.
- Preserve fail-closed runtime declaration, package-manifest, revision, and
  deployment-composition validation.

## Public Surface And Verification

- `@tradejs/node` has no root export. Public changes require an explicit
  subpath, build entry, declarations, and contract tests.
- Test deterministic logic directly and use adapters for connectors, time,
  filesystem, configuration loading, and other boundaries.
- Run focused tests, `yarn workspace @tradejs/node typecheck`, and
  `yarn workspace @tradejs/node build`.
- Before committing, run root `yarn prettify` and preferably `yarn checks`.
