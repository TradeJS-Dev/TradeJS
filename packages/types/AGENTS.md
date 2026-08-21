# Shared Types Package Guide

## Scope

This file applies to `packages/types` and supplements the repository-level
`../../AGENTS.md`.

## Local Rules

- Keep this package limited to shared TypeScript contracts, discriminants, and
  data shapes. It must not own runtime behavior or side effects.
- Avoid imports from `core`, `node`, `infra`, `cli`, connectors, or strategy
  packages; dependency direction flows from implementations to types.
- Model invariants with precise unions and required fields where callers can
  satisfy them. Use `unknown` at untrusted input seams and narrow in the owning
  implementation.
- Coordinate contract changes with every producer, consumer, serializer, and
  persisted schema in the same task.
- Keep the root export intentional and avoid compatibility aliases without an
  explicit migration requirement.

## Tests And Verification

- Add compile/runtime contract tests for discriminants, normalization helpers,
  or serialization-sensitive shapes when applicable.
- Run focused tests, `yarn workspace @tradejs/types typecheck`, and
  `yarn workspace @tradejs/types build`.
- Before committing, run root `yarn prettify` and preferably `yarn checks`.
