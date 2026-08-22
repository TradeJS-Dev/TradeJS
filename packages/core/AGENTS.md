# Core Package Guide

## Scope

This file applies to `packages/core` and supplements the repository-level
`../../AGENTS.md`.

## Local Rules

- Keep this package browser-safe, deterministic, and free of Node-only or
  infrastructure dependencies.
- Import core-internal helpers through package-local aliases such as
  `#utils/*` and `#constants`; do not introduce repository-wide aliases.
- Keep shared logic strategy-neutral. Strategy-specific detectors and behavior
  belong in standalone strategy repositories.
- Prefer pure calculations and explicit inputs over process state, storage,
  connector access, or hidden caches.
- Preserve replay/live parity and the canonical indicator/base-context shapes
  described in the root guide.

## Public Surface And Verification

- `@tradejs/core` has no root export. Public changes require an explicit
  subpath entry, build entry, types, and contract tests.
- Test through public subpath seams or package-local deterministic interfaces.
- Run focused tests, `yarn workspace @tradejs/core typecheck`, and
  `yarn workspace @tradejs/core build`.
- Before committing, run root `yarn prettify` and preferably `yarn checks`.
