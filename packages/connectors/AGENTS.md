# Connectors Package Guide

## Scope

This file applies to `packages/connectors` and supplements the repository-level
`../../AGENTS.md`.

## Local Rules

- Implement exchange and market-data adapters against contracts from
  `@tradejs/types`.
- Keep venue-specific protocol details inside the matching connector folder;
  move genuinely shared transport behavior to `src/shared` or
  `src/marketData`.
- Do not put strategy decisions, backtest policy, runtime orchestration, or
  persistence ownership in connectors.
- Preserve normalized symbols, timestamps, directions, fees, and capability
  declarations at the connector seam.
- Treat network clients, clocks, and exchange responses as external adapters in
  tests; keep normalization logic deterministic.

## Public Surface And Verification

- The package currently exposes its root entry. Update `src/index.ts`, build
  configuration, and tests together when changing that surface.
- Run focused connector tests, `yarn workspace @tradejs/connectors typecheck`,
  and `yarn workspace @tradejs/connectors build`.
- Before committing, run root `yarn prettify` and preferably `yarn checks`.
