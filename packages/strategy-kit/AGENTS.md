# Strategy Kit Routing Guard

## Scope

This file applies to `packages/strategy-kit` and supplements the
repository-level `../../AGENTS.md`.

## Ownership

- This directory is not the canonical `@tradejs/strategy-kit` source.
- The canonical repository is
  `~/dev/tradejs/tradejs-strategy-kit`.
- Move only strategy-neutral helpers used by at least two unrelated strategies
  into that repository and preserve its subpath-only public surface.
- Do not add registry, infrastructure, order-placement, or copied strategy
  behavior here.

## Verification

Run `yarn checks` from `~/dev/tradejs/tradejs-strategy-kit` for Strategy Kit
changes.
