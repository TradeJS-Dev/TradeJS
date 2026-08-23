---
name: strategy-forward-start
description: Publish and start the latest eligible best candidate for one TradeJS strategy as a bounded forward test with MAX_LOSS_VALUE=1, whether the strategy is absent, already runs the same composition, or runs a different configuration. Use only when the user explicitly asks to launch the forward test.
---

# Strategy Forward Start

Require one exact strategy name. Invocation of this skill is authorization to
roll out only that strategy’s latest checksum-verified, forward-eligible best
candidate at `MAX_LOSS_VALUE=1`. It is not authorization to select a different
candidate, retune it, increase risk, or touch unrelated strategies.

## Preconditions

Resolve the exact runtime user, deployment, account, connector, symbols, and
release mechanism from Git-owned project/deployment configuration. Resolve the
candidate’s source SHA, package version, lockfile boundary, full effective core
config, deterministic gate/context, direction policy, evidence hashes, and
forward eligibility. Do not infer production from Redis.

Stop before mutation if the target binding is ambiguous, credentials/registry
authorization is missing, the candidate is not reproducible, required checks
fail, another rollout is active, or safe atomic deployment is unavailable.
Give the exact command or UI boundary the user must complete; never start an
interactive authentication flow.

## Release and configure

1. Re-run source package checks at the selected commit. If the candidate uses
   unpublished source, commit and push the complete accumulated release range,
   publish one immutable stable package through the repository’s existing
   release workflow, and verify the registry artifact. Do not cherry-pick only
   one fix out of an accumulated unshipped range.
2. Install the exact package version in the Project and commit the lockfile.
3. Write the candidate’s complete reviewed configuration to the selected
   deployment in `tradejs.config.ts` and force `MAX_LOSS_VALUE=1`:
   - if the strategy is absent, add and enable it;
   - if it runs a different composition, replace that strategy declaration in
     one guarded cutover while preserving unrelated strategies;
   - if the exact composition already runs at risk 1, make no config change and
     continue with idempotent verification.
4. Run strict Project checks and runtime-control verification. Commit and push
   the complete Project release range, publish/deploy its exact immutable tip
   through the configured production workflow, and wait for the deployment
   handoff to finish.

## Verify the forward test

Confirm the deployed package/config manifest, `strategyRevision`,
`deploymentCompositionId`, account binding, enabled strategy, risk value,
heartbeat, and that exactly one managed runtime process owns the deployment.
Verify that the configured runtime actually permits bounded order placement;
signal-only evaluation is not a started forward test.

Never place, cancel, or close an order manually and never launch an unmanaged
background daemon. Do not wait for profitable 7d/30d/180d tails: forward
learning starts immediately at risk 1. Return commits, package version,
deployment identity, exact config diff, verification evidence, monitoring
command, and rollback/stop procedure.
