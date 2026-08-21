# Native Package Routing Guard

## Scope

This file applies to `packages/native` and supplements the repository-level
`../../AGENTS.md`.

## Ownership

- This directory is not currently a workspace package.
- Native binaries and `target/` output are generated artifacts and remain
  ignored by Git.
- Do not introduce native source, build scripts, or a package manifest here
  without an explicit architecture and ownership decision.
- Do not commit `.node` binaries or compiled toolchain output.

## Verification

If native support is explicitly introduced, define its reproducible source
build and CI verification before adding generated artifacts.
