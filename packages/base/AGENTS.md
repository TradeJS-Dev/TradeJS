# Base Package Routing Guard

## Scope

This file applies to `packages/base` and supplements the repository-level
`../../AGENTS.md`.

## Ownership

- This directory is not a workspace package and must not contain an
  `@tradejs/base` implementation.
- The canonical `@tradejs/base` source is
  `~/dev/tradejs/tradejs-base`.
- Make default package-composition changes in that external repository.
- Do not copy framework, strategy, or generated package source into this
  directory.

## Verification

Run `yarn checks` from `~/dev/tradejs/tradejs-base` for changes owned by the
Base repository.
