# Contributing to TradeJS

Thanks for helping improve TradeJS. Contributions can include bug reports,
feature proposals, documentation, tests, strategies, indicators, connectors, and
code changes.

## Before You Start

- Use [GitHub Discussions](https://github.com/TradeJS-Dev/TradeJS/discussions)
  for questions and open-ended proposals.
- Use [GitHub Issues](https://github.com/TradeJS-Dev/TradeJS/issues) for
  reproducible bugs and agreed, actionable work.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Search existing issues and discussions before opening a new one.

For a substantial change or a new public API, start an Ideas discussion first.
This helps confirm the scope and package boundary before implementation work
begins.

## Repository Scope

TradeJS is a monorepo. Its main areas are:

- `apps/app` — the Next.js UI and API package
- `packages/core` — browser-safe public APIs and shared helpers
- `packages/node` — Node-only strategy and backtest runtime
- `packages/types` — shared contracts
- `packages/infra` — storage, network, and infrastructure adapters
- `packages/indicators` — built-in indicators
- `packages/connectors` — exchange connectors and market data providers
- `packages/cli` — operational commands
- `examples/sandbox` — an external-user-style example using published packages

Built-in strategies, `@tradejs/strategy-kit`, and `@tradejs/base` are maintained
in their own repositories. Send strategy changes to the matching
`TradeJS-Strategy-*` repository; TrendLine and ReverseTrendLine intentionally
share `TradeJS-Strategy-TrendLine`. See [REPOSITORIES.md](REPOSITORIES.md).

Public documentation and the marketing site are maintained separately:

- [TradeJS-Docs](https://github.com/TradeJS-Dev/TradeJS-Docs) for external user
  documentation
- [TradeJS-Site](https://github.com/TradeJS-Dev/TradeJS-Site) for
  [tradejs.dev](https://tradejs.dev)

Send changes to those repositories when they belong to a public article or the
website rather than this monorepo.

## Local Development

Prerequisites:

- Node.js `24.17.0` (see `.nvmrc`)
- Yarn `4.x` through Corepack
- Docker and Docker Compose for infrastructure-dependent flows

Install dependencies:

```bash
corepack enable
nvm use
yarn
```

Start local infrastructure and the app when the change requires them:

```bash
yarn infra-up
yarn doctor
yarn dev
```

Keep secrets in local environment files. Never commit API keys, exchange
credentials, tokens, datasets containing private account data, or production
configuration.

## Making Changes

1. Create a focused branch from `stable`.
2. Keep the diff limited to one coherent change.
3. Add or update tests for behavior changes.
4. Update user-facing or internal documentation where appropriate.
5. Add a concise entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for a
   notable user-facing change.

Preserve the package boundaries described above. Use explicit public subpath
imports such as `@tradejs/core/strategies`, `@tradejs/node/registry`, and
`@tradejs/infra/redis`; do not import package internals through `src` paths or
reintroduce root imports for subpath-first packages.

Strategies should keep deterministic signal detection replay-safe and leave
orders, AI/ML calls, and other side effects to the shared runtime. Geometry-based
strategies should emit figures that make their decisions inspectable.

The sandbox intentionally installs published `@tradejs/*` packages and must not
be coupled to workspace sources.

## Checks

After code changes, format first:

```bash
yarn prettify
```

Run the full verification suite when practical:

```bash
yarn checks
```

This covers build, lint, type checking, and unit tests. For a small change, run
the closest targeted test while iterating, then use the full suite before
requesting review. Package-boundary changes should be verified with at least:

```bash
yarn typecheck
yarn build
yarn unit
```

For sandbox changes, also run:

```bash
yarn sandbox:install
yarn sandbox:e2e
```

If a check needs unavailable infrastructure or credentials, state exactly what
was not run and why in the pull request.

## Pull Requests

Open a pull request against `stable`. In its description, include:

- the problem and intended behavior
- the implementation approach and important trade-offs
- verification performed
- screenshots or recordings for visible UI changes
- migration, compatibility, configuration, and security implications

Use clear, imperative commit subjects. Keep generated files and unrelated
formatting out of the diff. Maintainers may ask for a change to be split when it
crosses unrelated package or architectural boundaries.

By contributing, you agree that your contribution is licensed under the
license that applies to its target path as described in
[LICENSING.md](LICENSING.md). You also grant the TradeJS-Dev maintainers a
perpetual, worldwide, royalty-free, irrevocable license to use, reproduce,
modify, distribute, sublicense, and relicense your contribution, including
under commercial terms. Do not submit a contribution if you do not have the
right to grant these permissions.
