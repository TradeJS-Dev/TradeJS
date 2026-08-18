# Cut over to one canonical runtime path

Production runtime accepts only an explicit deployment binding whose strategy
references are exactly `{ strategyName, releaseVersion, controlState }`. The
referenced immutable release owns interval, universe, policy, risk, and exact
strategy/runtime package names and versions; the deployment owns connector,
account, tickers, and entry control.

There is no runtime fallback to mutable strategy configs, result overlays,
drafts, embedded deployment fields, missing control state, user-level exchange
credentials, or alternate Redis persistence layouts. Initial setup uses the
explicit `runtime-config provision` command. Later changes use `rollout`, and
rollback is an intentional pointer change to an existing immutable release in
`entries_paused`, not a legacy recovery path.

The UI renders release config read-only and can only pause or resume new
entries. Production identity is the per-strategy `releaseVersion`; research
artifacts may retain their own checksums and fingerprints, but those values are
not deployment identity and never select runtime config.

This is a deliberate breaking cutover. Invalid or old Redis records fail
verification and must be rewritten to the canonical schema before the new
runtime image is deployed.
