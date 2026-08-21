# Project Generator Package Guide

## Scope

This file applies to `packages/create-tradejs` and supplements the
repository-level `../../AGENTS.md`.

## Local Rules

- Treat generated project files and command output as the package's public
  interface.
- Generate workflows that work with published `@tradejs/*` packages; do not
  depend on monorepo-only paths, aliases, build artifacts, or unpublished
  source.
- Keep templates secret-free and portable across supported Node/package-manager
  environments.
- Coordinate changes that affect the personal runtime composition with
  `TradeJS-Project` ownership rules rather than embedding framework source.

## Tests And Verification

- Test generated paths, file contents, cleanup, and error messages through the
  generator interface.
- Run `yarn workspace create-tradejs typecheck`, focused tests, and
  `yarn workspace create-tradejs build`.
- Before committing, run root `yarn prettify` and preferably `yarn checks`.
