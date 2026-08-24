---
name: save-strategy-config-from-backtest
description: Promote a TradeJS backtest config grid from research Redis into the Git-owned runtime declaration in TradeJS-Project tradejs.config.ts. Use when the user asks to copy, promote, or save a backtest candidate for runtime or forward testing.
---

# Promote Strategy Config From Backtest

## Repository boundary

Run from `/Users/aleksnick/dev/tradejs/tradejs-project`. This repository owns
`tradejs.config.ts`, the exact package dependencies, and the runtime image.
Research Redis is only the source of the backtest candidate; production Redis
must never receive strategy config, deployment documents, or version pointers.

## Workflow

1. Resolve the exact user, strategy, source backtest config, target deployment,
   and intended risk. Default the research user to `root`, but never guess a
   production account or deployment.
2. Read the source grid from
   `users:<user>:backtests:configs:<Strategy>:<name>` with RedisJSON. A missing
   source is a blocker; do not fall back to `users:*:strategies:*:config`.
3. Convert the grid to one plain strategy config. Unwrap one-element arrays.
   For multi-value arrays, resolve the exact winning result/config id or ask the
   user; never choose a value arbitrarily. Preserve nested `LONG`, `SHORT`, AI,
   detector, and risk objects.
4. Remove operational/mode fields: `ENABLE`, `ACCOUNT_ID`, `DEPLOYMENT_ID`,
   `ENV`, `MAKE_ORDERS`, `RECORD_RUNTIME_TRADES`, and `AI_REPLAY_ANALYSES`.
   Keep `INTERVAL`, `UNIVERSE`, `POLICY_PROFILE_ID`, execution semantics, AI
   mode, thresholds, and the complete strategy behavior config. For an
   authorized micro-forward use `MAX_LOSS_VALUE=1`; otherwise preserve the
   explicitly selected risk.
5. Update the strategy entry under
   `runtime.deployments.<deployment>.strategies.<Strategy>` in
   `tradejs.config.ts`. Store exactly `{ generation?, enabled, selection?,
   config }`. `generation` is optional human metadata. Never add or increment a
   technical version: Project validation computes `strategyRevision` and
   `deploymentCompositionId`. Keep account, connector, tickers, and asset
   classes at deployment level.
6. Ensure `package.json` and `yarn.lock` select the exact stable strategy
   package containing the candidate. Normal development verifies a beta first;
   committed Project and production use the protected stable promotion.
7. Run Project validation, record the computed revisions, and run
   `yarn runtime-control verify`. A production-like image smoke must prove that
   the config loads with no controls key, pause creates only
   `users:<user>:runtime:controls`, and resume removes it.

## Safety

- Never write a runtime strategy config to Redis.
- Never copy credentials into `tradejs.config.ts` or research evidence.
- Do not overwrite another strategy or deployment while promoting one
  candidate.
- A UI pause is an optional Redis override; desired activation remains the
  committed `enabled` value.
- Commit and push only when the user requested the rollout through the active
  `$strategy-forward-start` workflow, which owns the complete forward-test
  handshake.
