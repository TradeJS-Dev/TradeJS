# Changelog

All notable user-facing changes to TradeJS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and published packages follow [Semantic Versioning](https://semver.org/).
Changelog tracking began on 2026-07-15; earlier changes have not been
reconstructed release by release.

## Unreleased

### Changed

- Moved every built-in strategy into an independently versioned
  `@tradejs/strategy-*` package and repository. TrendLine and ReverseTrendLine
  intentionally remain one atomic `@tradejs/strategy-trend-line` family.
- Moved `@tradejs/strategy-kit` and the non-empty `@tradejs/base` preset to
  dedicated repositories.
- Moved the personal production app image and secret-free runtime defaults to
  `TradeJS-Project`; `TradeJS-Deploy` remains responsible for server rollout,
  secrets, Compose, TLS, and volumes.
- Research-agent changes now target the owning strategy repository and require
  that repository's full `yarn checks` before creating a pull request.

### Migration

- Replace the retired `@tradejs/strategies` aggregate with either
  `@tradejs/base` or explicit `@tradejs/strategy-*` packages in
  `tradejs.config.ts`.
- Move personal runtime composition and production app-container changes to
  `TradeJS-Project`.

## 3.0.0 - 2026-08-13

### Changed

- Moved browser-safe AI endpoint, language, and model configuration from
  `@tradejs/infra/aiEndpoints`, `@tradejs/infra/aiLanguages`, and
  `@tradejs/infra/aiModels` to the equivalent `@tradejs/core/*` subpaths.
  Infra user settings now return raw stored values; runtime and UI composition
  layers normalize them through `@tradejs/core`.
- Replaced the aggregate `@tradejs/infra/timescale` entrypoint with focused
  `@tradejs/infra/timescale/*` subpaths. Import candles, derivatives, spread,
  market context, Hyperliquid whale context, or the client explicitly.
- Removed the runtime-backed `Test` connector from `@tradejs/connectors`, so
  that connector plugins no longer depend on `@tradejs/node`. Backtest callers
  that need a test connector should use `createTestConnector` from
  `@tradejs/node/backtest`.
- Removed `ensureAiStrategyPluginsLoaded` from `@tradejs/node/ai`. Composition
  roots should call `ensureStrategyPluginsLoaded` from `@tradejs/node/registry`;
  the built-in CLI AI and Telegram paths now do this explicitly.
- Package and intra-package dependency cycles are now rejected by
  `yarn architecture`, including transitive client imports of server-only
  packages.

### Migration

- Replace `@tradejs/infra/aiEndpoints` with `@tradejs/core/aiEndpoints`.
- Replace `@tradejs/infra/aiLanguages` with `@tradejs/core/aiLanguages`.
- Replace `@tradejs/infra/aiModels` with `@tradejs/core/aiModels`.
- Replace `@tradejs/infra/timescale` imports with the narrowest matching
  `@tradejs/infra/timescale/*` subpath.
- Replace `ConnectorNames.Test` and `connectors.Test` with an explicit
  `createTestConnector` call from `@tradejs/node/backtest`.

## 2.0.0 - 2026-07-17

### Changed

- Adopted a mixed-license open-core model. Product components are now licensed
  under Business Source License 1.1 with an Additional Use Grant that permits
  non-competing production and internal use; SDK, integration, scaffolding,
  and example components remain MIT-licensed.
- Added package-local license files so every published npm archive carries its
  applicable terms.
- Releases through 1.0.12 remain available under the MIT License.

### Added

- Contributor and security policies for the repository.
- Community support and feature-proposal guidance through GitHub Discussions.

## 1.0.9 - 2026-05-02

This is the latest npm package release from before the changelog was introduced.
For earlier changes, see the
[commit history](https://github.com/TradeJS-Dev/TradeJS/commits/stable/) and the
version history of each package on npm.
