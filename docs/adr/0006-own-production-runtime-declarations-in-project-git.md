# Own production runtime declarations in Project Git

Status: identity and rollout-version sections superseded by ADR 0007. The
Project/Redis ownership boundary remains accepted.

Production deployments and complete strategy configs live only under
`runtime.deployments` in `TradeJS-Project/tradejs.config.ts`. ADR 0007 replaces
the former manual per-strategy version with computed runtime identity. Exact
npm package versions remain in the Project lockfile and strict image manifest.

The declaration owns connector, provider, account id, ticker/asset-class scope,
interval, universe, policy, risk, and enabled defaults. Runtime validates the
whole declaration and installed package inventory. It does not merge or fall
back to Redis deployment documents, strategy configs, result overlays,
per-strategy releases, fingerprints, Git SHAs, or evidence artifacts.

Redis owns only server state: trading accounts and credentials, optional manual
pause overrides, control audit events, heartbeats, signals, evaluations, and
trades. `users:<user>:runtime:controls` may be absent. Pause lazily writes only
an `entriesPaused: true` override; resume removes it and deletes the document
when empty. Missing controls mean “follow Git enabled,” while malformed data or
Redis unavailability fails closed. Git-disabled strategies cannot be manually
resumed, and existing positions remain managed while entries are paused.

The Strategies UI renders the committed config read-only and exposes only
pause/resume. It does not display production evidence status. Research evidence
and fingerprints may still exist in local/CI artifacts for scientific
verification, but they never select production behavior.

A forward-test rollout is therefore one auditable chain: publish and validate
the candidate packages, update the exact Project dependency plus full config in
one commit, validate the computed strategy/deployment identity, build one
immutable Project image, deploy that SHA, verify the declaration/account
binding, and only then apply an optional pause override. Rollback deploys an
earlier Project SHA; it does not move a Redis release pointer.

This is a breaking cutover with no legacy read fallback. After the first
healthy deployment, obsolete production Redis deployment/config/release keys
are backed up, inventoried, and deleted through an explicit allowlisted cleanup.
