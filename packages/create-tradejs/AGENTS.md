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
- Treat repository-root `.codex/skills` as the single editable source for the
  focused Project skill bundle. Do not restore committed copies under
  `templates/.codex/skills`; the package build stages them into `dist` with a
  checksum manifest.
- Existing projects update the managed bundle only through
  `create-tradejs --update-skills`. Preserve unrelated and locally authored
  skills, and refuse to overwrite modified managed files without an explicit
  future conflict-resolution contract.
- Coordinate changes that affect the personal runtime composition with
  `TradeJS-Project` ownership rules rather than embedding framework source.

## Tests And Verification

- Test generated paths, file contents, cleanup, and error messages through the
  generator interface.
- Run `yarn workspace create-tradejs typecheck`, focused tests, and
  `yarn workspace create-tradejs build`.
- Inspect `yarn workspace create-tradejs pack --dry-run` after changing bundle
  staging or package files.
- Before committing, run root `yarn prettify` and preferably `yarn checks`.
