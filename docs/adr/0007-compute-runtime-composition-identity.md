# Compute runtime composition identity

Status: accepted. Supersedes the identity and rollout-version parts of ADR
0006; the ownership boundary established there remains in force.

`TradeJS-Project/tradejs.config.ts` is the only production runtime declaration.
A strategy binding is `{ generation?, enabled, selection?, config }`.
`generation` is an optional operator-facing label and never participates in
technical identity. There is no manually incremented runtime version.

Every strategy package owns a mandatory `StrategyRegistryEntry.parseConfig`.
The parser accepts the untrusted Project config, rejects unknown fields and
invalid value shapes, and returns the complete effective config materialized
from package defaults. Runtime composition resolution fails if a configured
plugin cannot be imported, does not export entries, omits its parser, or
declares duplicate strategies.

The runtime computes two canonical SHA-256-derived identifiers:

- `strategyRevision` (`sr1:`) covers the strategy name, exact strategy package
  name/version, the verified versions of its direct `@tradejs/*` runtime
  dependencies, exact `@tradejs/node` version, and parsed effective config.
- `deploymentCompositionId` (`dc1:`) covers the deployment execution target,
  enabled state, asset-class scope, and the sorted strategy bindings with their
  revisions and effective ticker selections.

Canonical JSON sorts object keys. Ticker and asset-class collections are sorted
because they are sets; declarations reject empty members and duplicates. Arrays
inside strategy config retain order. Redis pause overrides are operational
state and do not alter either Git-owned identifier.

`runtime-package-manifest.json` is required at composition resolution. It has
the exact schema `tradejs-runtime-package-manifest/v1`. Every package version
used in composition, including the strategy's direct TradeJS dependency
closure, must be present and must equal the corresponding installed
`package.json`. The manifest also requires the exact 40-character Project Git
SHA. A missing, malformed, or stale manifest fails the runtime.

Signals, evaluations, trades, control audit events, evidence snapshots,
replays, dashboard views, and lifecycle keys carry the computed revision rather
than a numeric runtime version. Revision lineage uses schema version 3 and binds
both computed identifiers plus exact package versions. Research fingerprint
lineage remains a separate schema for non-deployment experiments; it is not a
production fallback.

This is a coordinated breaking release. All official strategy packages,
Strategy Template, Project validation, and production-like beta smoke move to
the contract together. Runtime does not accept entries or evidence from the
superseded numeric-version schema.
