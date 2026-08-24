---
name: strategy-forward-start
description: Publish and start one exact TradeJS strategy candidate as a bounded production forward test with MAX_LOSS_VALUE=1. Supports either the latest eligible best candidate or a checksum-reproducible historically promising candidate that the user explicitly names for prospective-only learning. Use only when the user explicitly asks to launch the forward test.
---

# Strategy Forward Start

Require one exact strategy name. Invocation of this skill is authorization to
roll out only that strategy at `MAX_LOSS_VALUE=1`. By default, use its latest
checksum-verified, forward-eligible best candidate. If the user explicitly
names a different historically promising candidate and requests a production
forward test, use the operator-directed prospective mode below. Neither mode is
authorization to retune the candidate, increase risk, or touch unrelated
strategies.

## Operator-directed prospective mode

An explicitly named candidate may proceed even when an immutable research
artifact selected another candidate, marked runtime mutation as disallowed, or
reported a sparse, flat, or negative recent diagnostic cohort. These facts
remain visible diagnostics; they are not by themselves blockers for collecting
new prospective evidence at risk 1.

Use this mode only when all of the following are true:

- the user names the exact strategy and candidate and explicitly authorizes its
  production forward test with `MAX_LOSS_VALUE=1`;
- the exact expression, direction policy, effective core configuration, source
  and data lineage, and evidence hashes are reproducible without new tuning;
- the maximum-covered historical window has positive net PnL and profit factor
  above 1, and its full-period metrics and chart remain available;
- a new immutable operator-authorization artifact references the original
  selection/freeze and the contrary or underpowered evidence; and
- the artifact states that the rollout is prospective-only and does not rewrite
  the old verdict or upgrade the candidate to historically validated.

Do not edit an old freeze, selection, progress, decision, or research verdict
to manufacture eligibility. Implement a research-only expression in the owned
strategy package before release, with focused tests that lock the exact
behavior.

## Preconditions

Resolve the exact runtime user, deployment, account, connector, symbols, and
release mechanism from Git-owned project/deployment configuration. Resolve the
candidate’s source SHA, package version, lockfile boundary, full effective core
config, deterministic gate/context, direction policy, evidence hashes, and
either standard forward eligibility or the immutable operator authorization.
Do not infer production from Redis.

Stop before mutation if the target binding is ambiguous, credentials/registry
authorization is missing, the candidate is not reproducible or implementable,
the maximum-covered historical edge is non-positive, required evidence/chart
hashes are missing, required checks fail, another rollout is active, or safe
atomic deployment is unavailable. These are operational or falsifiability
boundaries and operator-directed mode does not waive them. Give the exact
command or UI boundary the user must complete; never start an interactive
authentication flow.

## Release and configure

1. Re-run source package checks at the selected commit. If the candidate uses
   unpublished source, commit and push the complete accumulated release range,
   publish one immutable stable package through the repository’s existing
   release workflow, and verify the registry artifact. Do not cherry-pick only
   one fix out of an accumulated unshipped range.
2. Install the exact package version in the Project and commit the lockfile.
3. Write the candidate’s complete reviewed configuration to the selected
   deployment in the Git-owned Project runtime configuration and force
   `MAX_LOSS_VALUE=1`:
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
learning starts immediately at risk 1. Return the authorization mode and
artifact, preserved contrary evidence, commits, package version, deployment
identity, exact config diff, verification evidence, monitoring command, and
rollback/stop procedure.
