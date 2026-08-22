# TrendLine Kit Routing Guard

## Scope

This file applies to `packages/strategy-trendline-kit` and supplements the
repository-level `../../AGENTS.md`.

## Ownership

- This directory is not currently a workspace package and must not become an
  implicit shared-code location.
- TrendLine and ReverseTrendLine behavior is owned by
  `~/dev/tradejs/tradejs-strategy-trend-line`.
- Genuinely strategy-neutral helpers belong in
  `~/dev/tradejs/tradejs-strategy-kit`.
- Do not add source or a package manifest here without an explicit repository
  ownership decision.

## Verification

Run `yarn checks` in the canonical standalone repository that owns the change.
