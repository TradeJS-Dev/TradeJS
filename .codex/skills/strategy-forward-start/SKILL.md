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

Read
[`../strategy-backtest-research/references/production-baseline.md`](../strategy-backtest-research/references/production-baseline.md).
Resolve and preserve the existing production baseline before changing the
deployment; it remains authoritative until the cutover is verified.

Resolve the exact runtime user, deployment, account, connector, symbols, and
release mechanism from Git-owned project/deployment configuration. Resolve the
candidate’s source SHA, package version, lockfile boundary, full effective core
config, deterministic gate/context, direction policy, evidence hashes, and
either standard forward eligibility or the immutable operator authorization.
Do not infer production from Redis.

Stop before mutation if the target binding is ambiguous, credentials/registry
authorization is missing, the candidate is not reproducible or implementable,
the maximum-covered historical edge is non-positive, required evidence/chart
hashes are missing, required checks fail, another rollout for the same strategy
is active, a deployment or rollout cutover on the target is still in flight, or
safe atomic deployment is unavailable. An active risk-1 forward test for a
different strategy on the same deployment or account is not a blocker: preserve
its declaration and evidence, and do not confuse the presence of its active
rollout ledger with an in-flight cutover. Multiple strategies may intentionally
run concurrent forward tests, including when the operator uses
`MAX_LOSS_VALUE=1` as the forward-test marker. These operational and
falsifiability boundaries are not waived by operator-directed mode. Give the
exact command or UI boundary the user must complete; never start an interactive
authentication flow.

## Release and configure

1. Save the launch decision’s historical report under `launch-reports/<id>.json`
   in the strategy repository. Keep the ID specific to the candidate and decision.
   Use the `tradejs-launch-report/v1` schema from `@tradejs/types` with the SHA-256
   of the retained research source, backtest period, recorded risk, win rate, and
   available metrics. When the original equity series is available, record the
   longest continuous time below its previous peak, measured in calendar days
   from the first below-peak observation until recovery or the end of the window.
   Keep an adjacent `<id>.png` of the research chart and record its SHA-256 in
   `chart.sha256`. Use retained evidence and leave absent fields unset. Include
   only report-ready aggregate results because the package can be public.
   Export `"./launch-reports/*.json": "./launch-reports/*.json"` in the package
   and include `launch-reports` in `files`. Verify that the JSON and chart ship
   together in the packed tarball, and commit the report with the candidate.
2. Re-run source package checks at the selected commit. If the candidate uses
   unpublished source, commit and push the complete accumulated release range,
   publish one immutable stable package through the repository’s existing
   release workflow, and verify the registry artifact. Do not cherry-pick only
   one fix out of an accumulated unshipped range.
3. Install the exact package version in the Project and commit the lockfile.
4. Write the candidate’s complete reviewed configuration to the selected
   deployment in the Git-owned Project runtime configuration and force
   `MAX_LOSS_VALUE=1`. Set `launchReports[deploymentId][strategyName]` on the exported Project
   configuration to the packaged report ID:
   - if the strategy is absent, add and enable it;
   - if it runs a different composition, replace that strategy declaration in
     one guarded cutover while preserving unrelated strategies;
   - if the exact composition already runs at risk 1 with the same report ID,
     continue with idempotent verification.
5. Run strict Project checks and runtime-control verification. Commit and push
   the complete Project release range, publish/deploy its exact immutable tip
   through the configured production workflow, and wait for the deployment
   handoff to finish.

## Verify the forward test

Confirm the deployed package/config manifest, `strategyRevision`,
`deploymentCompositionId`, account binding, enabled strategy, risk value,
heartbeat, and that exactly one managed runtime process owns the deployment.
Verify that the configured runtime actually permits bounded order placement;
signal-only evaluation is not a started forward test.

After those checks pass, append an immutable production-baseline record to the
existing strategy release/candidate ledger. It must link the selected candidate
and evidence hashes to the verified deployment identity, mark this exact
composition `current-production-baseline`, and supersede the previous baseline
for future research without rewriting historical selection records. If any
cutover verification fails, do not create that marker and keep the previous
verified production composition as baseline.

Never place, cancel, or close an order manually and never launch an unmanaged
background daemon. Do not wait for profitable 7d/30d/180d tails: forward
learning starts immediately at risk 1. Return the authorization mode and
artifact, preserved contrary evidence, commits, package version, deployment
identity, exact config diff, verification evidence, monitoring command, and
rollback/stop procedure.
