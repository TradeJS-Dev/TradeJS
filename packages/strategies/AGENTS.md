# Strategies Routing Guard

## Scope

This file applies to `packages/strategies` and supplements the repository-level
`../../AGENTS.md`.

## Ownership

- This directory is not a workspace package and must not collect strategy
  implementations.
- Each strategy is owned by its canonical standalone
  `~/dev/tradejs/tradejs-strategy-*` repository listed in the root workspace
  guide.
- Put helpers shared by unrelated strategies in the external
  `tradejs-strategy-kit` repository, not here.
- Do not copy strategy source back into the framework monorepo.

## Verification

Run `yarn checks` in the standalone repository that owns the changed strategy.
