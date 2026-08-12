# AGENTS.md

## Scope

These repository rules apply to `/Users/aleksnick/dev/investing`.

## Purpose

Use this file as the default operating guide for automated agents in this repo.
Keep changes small, respect package boundaries, and align with the current TradeJS architecture.

## Repository Shape

TradeJS is a monorepo for:

- strategy authoring
- backtesting
- live signal generation
- optional auto-trading
- ML train/infer flows

Main areas:

- `apps/app` — publishable Next.js UI and API package, also used internally in the workspace
- `packages/core` — browser-safe public API, shared helpers, plugin config API
- `packages/node` — Node-only runtime, plugin loading, backtest/pine execution helpers
- `packages/types` — shared contracts and types
- `packages/infra` — Redis / Timescale / ML / IO adapters
- `packages/strategies` — built-in strategy plugins
- `packages/indicators` — built-in indicators
- `packages/connectors` — built-in connectors and market data providers
- `packages/base` — default preset wiring built-ins
- `packages/cli` — operational commands
- `examples/sandbox` — standalone deterministic external-user style example app that installs published `@tradejs/*` packages from npm

Public web repos now live outside this monorepo:

- `TradeJS-Site` — source of truth for `tradejs.dev`
- `TradeJS-Docs` — source of truth for `docs.tradejs.dev`

This monorepo no longer carries the source code for those public web surfaces.

Local checkouts for those repos in this environment:

- `TradeJS`: `~/dev/investing`
- `TradeJS-Site`: `~/dev/tradejs-site`
- `TradeJS-Docs`: `~/dev/tradejs-docs`

Local clone policy for `TradeJS-Dev` repositories:

- keep local clones under `~/dev/...`
- do not clone or stage working copies under `/tmp`

## Audience Rules For Documentation

This rule is important and should be treated as architectural, not editorial.

- `TradeJS-Docs` is for external package users.
- package `README.md` files are also for external package users.
- When a user asks to update public docs articles or site content, search and edit the external repo directly instead of adding surrogate notes in this monorepo.
- If the user says "docs", "knowledge base", "documentation", or similar user-facing wording without explicitly saying "internal", default to the external `TradeJS-Docs` repo at `~/dev/tradejs-docs`, not to internal markdown, notes, skills, or `AGENTS.md` in this monorepo.
- Do not document repo-only flows in `TradeJS-Docs`.
- Do not tell external users to run monorepo-only commands like `yarn dev`, `yarn workspace @tradejs/app dev`, or similar internal workflows in public docs unless the package flow truly supports them.
- Internal repository workflows belong in root markdown files:
  - `README.md`
  - `QUICKSTART.md`
  - `STRATEGY_API.md`
- User-facing setup and account-management articles belong in `TradeJS-Docs`, not in root markdown files here.

If a feature is not publish-ready for external users, document that limitation explicitly instead of implying a working package flow.

## Internal Notes

- Everything under `notes/` is local-only and permanently ignored by Git. Never stage, commit, or force-add any file from `notes/`.
- Internal research notes and audit-style markdown files live under strategy/category directories, never directly under `notes/` or in the repo root.
- Strategy research path: `notes/<Strategy>/YYYY-MM-DD-<short-kebab-slug>.md`, using the exact strategy directory name from `packages/strategies/src`.
- Repository-wide architecture/ML records live under `notes/Shared/`; one comparison spanning several strategies lives under `notes/CrossStrategy/`.
- One research question plus one immutable run/export lineage equals one file. A new export, run, hypothesis family, or decision requires a new file; do not append dated entries to a rolling strategy log.
- Every new record must follow `.codex/skills/strategy-backtest-research/references/research-notes.md` and begin with `schema: tradejs-research/v1` frontmatter.
- The local note is the durable metric record relative to disposable exports and caches. For `reproduction: complete`, embed the full secret-free resolved config, exact commands/selection/partitions, git and gate/config/context lineage, and the complete machine-readable metrics JSON needed to rebuild every displayed table after exports, Redis data, cache, or `data/ai/output` artifacts are deleted.
- Artifact paths and mutable config names are inventory only, not sufficient reproduction evidence. Never fill missing historical fields from current defaults; mark them `partial`, `blocked`, or `legacy-partial`.
- Migrated historical examples now live under paths such as `notes/TrendLine/`, `notes/Shared/`, and `notes/CrossStrategy/`.
- Keep root markdown focused on stable repository guidance and runnable internal workflows.
- Strategy-specific agent workflows may live under `.codex/skills/` when they capture repeatable internal research or tuning procedures.

## Architecture Rules

### Package Boundaries

- `@tradejs/core` is browser-safe public API.
- `@tradejs/node` is Node/server runtime.
- `@tradejs/types` contains shared contracts.
- `@tradejs/infra` contains infra adapters and storage/network integrations.

Do not blur these boundaries without explicit request.

### Public Surface Rules

- `@tradejs/core`, `@tradejs/node`, and `@tradejs/infra` are subpath-first packages.
- `@tradejs/core` has no root export.
- `@tradejs/node` has no root export.
- `@tradejs/infra` has no root export.

Keep public APIs expressed through explicit subpaths such as:

- `@tradejs/core/data`
- `@tradejs/core/strategies`
- `@tradejs/node/pine`
- `@tradejs/node/registry`
- `@tradejs/infra/redis`
- `@tradejs/infra/logger`

### Import Rules

For production code:

- import plugin registration from `@tradejs/core/config`
- import browser-safe helpers from public `@tradejs/core/*` subpaths
- import Node runtime helpers from public `@tradejs/node/*` subpaths
- import infra adapters from public `@tradejs/infra/*` subpaths
- import shared contracts from `@tradejs/types`
- inside `packages/core`, import core-internal helpers through package-local `imports` such as `#utils/*` and `#constants`
- inside `apps/app`, prefer app-local `imports` such as `#app/*`, `#actions/*`, `#store`, `#shared/*`, `#ui`, `#components/*`

Do not:

- use non-public deep imports like `@tradejs/core/src/*` or `@tradejs/node/src/*`
- use non-public deep imports like `@tradejs/infra/src/*`
- reintroduce root imports like `@tradejs/core`, `@tradejs/node`, or `@tradejs/infra`
- add global root-level TypeScript aliases for package-internal modules like `@utils/*` or `@constants`; keep package-internal aliases package-local

### Build Isolation Rules

- Package builds must not depend on `apps/app/.next` or other generated app artifacts.
- `tsup` packages should use package-local `tsconfig.build.json`, not the root build config.
- Tests should live in the package that owns the code under test.
- Do not leave `core` tests pointing at `node` or `infra` internals.

### Strategy Runtime Rules

`core.ts` in a strategy should:

- evaluate entry/exit logic
- return `skip`, `entry`, or `exit`
- generate `figures` for visual inspection when a strategy depends on recognizable chart geometry such as trendlines, pivots, breakouts, bands, or double-top/double-bottom patterns

`core.ts` should not:

- call AI prompt pipeline directly
- call ML gRPC directly
- place/close orders directly

Use `strategyApi` and shared runtime instead.

`strategyApi.entry(...)` expectations:

- strategy provides `direction` and `orderPlan`
- `code` is optional
- runtime resolves `timestamp`, `currentPrice`, `takeProfitPrice`, `riskRatio`

`entryContext` is the source of truth for runtime execution fields.

Geometry-based strategies should keep visual artifacts in the strategy package:

- build figures from deterministic runtime state, not from UI-only code
- include enough lines/points to inspect why a trade happened in backtest artifacts
- avoid relying on Pine drawings as the source of truth after a strategy is ported to TypeScript

Stateful strategy best practices:

- If a strategy keeps rolling detector state, pivots, zones, trend state, pending signals, or delayed confirmation state, put that logic behind a replayable engine API such as `createXEngine({ initialCandles })` with `next(candle)` and `getState()`.
- Engine construction must rebuild state by replaying `initialCandles` through the same transition path used for live candles. Do not only seed derived arrays from history while leaving pending/confirmation state empty.
- `core.ts` should call the engine for the current candle and keep StrategyAPI side effects, position checks, order planning, and indicators payload wiring outside the detector engine.
- Add unit coverage proving `initialCandles + next(lastCandle)` matches a continuous run, especially for strategies with pending confirmation on the next bar.
- Do not change strategy engine or shared execution behavior unless the user explicitly asks for that implementation change. When a runtime/execution behavior change looks useful, propose it first and continue with data/config work unless approved.

Strategy authoring best practices:

- Build new strategies as replay-safe from the first implementation. The core runner should make decisions from the current closed candle, replayable engine state, and StrategyAPI context helpers, not from ad hoc market snapshots.
- Prefer `strategyApi.getDecisionPriceContext()` for signal-time `timestamp`, `currentPrice`, and current candle access. StrategyAPI does not expose full market history or connector-backed market snapshots to strategy cores.
- Prefer `strategyApi.getCurrentIndicatorsContext()` or `strategyApi.getBaseContext()` for indicator and shared context reads. The indicator snapshot type is inherited from `CreateStrategyCore`; do not provide a generic type argument. Avoid direct `indicatorsState.onBar()` / `indicatorsState.snapshot()` in new strategy cores unless the code is inside an intentional once-per-candle detector transition.
- Do not fetch or read full market history in strategy cores. If a detector or guardrail needs recent candles, keep a bounded replayable history in `strategyApi.createStateController(...)`, seed it from `initialData`, append the current candle once per timestamp, and store only the required tail.
- Keep detector engines pure: no StrategyAPI calls, no positions, no order plans, no AI/ML calls, no connector access. Engines should accept candle/config input and return deterministic signal/state output.
- Keep execution decisions in `core.ts`: position checks, cooldown, policy gates, risk sizing, figures, `strategyApi.entry(...)`, and `strategyApi.exit(...)` belong outside the detector engine. Do not return raw exit objects or provide manual exit price/timestamp fields.
- Build figures from deterministic engine/baseContext/signal data. Do not depend on UI-only code or unbounded market history to explain an entry.
- Resolve BTC/ETH, MTF, derivatives, relative-strength, and venue-spread inputs at or before the evaluated candle timestamp. Prefer fields already normalized in `additionalIndicators.baseContext` / `baseContext` over custom lookup chains.
- For order entry, pass `direction`, `orderPlan`, optional `code`, `figures`, `indicators`, and `additionalIndicators` to `strategyApi.entry(...)`; let the shared runtime resolve entry context fields.
- Add focused unit tests for every new strategy covering continuous run vs `initialCandles + next(lastCandle)`, same-timestamp idempotence, delayed/pending confirmation state, entry/exit payload shape, and any bounded-history guardrail behavior.

Runtime AI config conventions:

- `AI_ENABLED` remains the primary runtime AI on/off switch, matching the existing `ML_ENABLED` convention.
- `AI_MODE` selects the AI decision source when `AI_ENABLED=true`.
- Supported `AI_MODE` values are:
  - `llm` — default; runtime calls the configured AI provider and uses the LLM analysis for the AI quality gate.
  - `gate` — runtime uses the local deterministic strategy AI gate for entry quality, while still calling the configured AI provider for Telegram commentary and later gate-vs-LLM comparison.
- In `gate` mode, persist the LLM analysis with gate comparison metadata (`gateAnalysis`, `gateDecision`, `llmDecision`, `gateContradictsLlm`) so later research can compare live gate and LLM behavior.
- Keep `MIN_AI_QUALITY` as the shared quality threshold for both `gate` and `llm` decisions.
- Runtime/replay/signals config normalization goes through `packages/cli/src/lib/runtimeModeConfig.ts`; use that helper instead of duplicating `ENV`, `INTERVAL`, `MAKE_ORDERS`, or mode-specific overrides in scripts.

### Indicator Rules

- Keep shared indicator logic neutral and reusable.
- Do not add strategy-specific branches inside shared indicator modules unless explicitly requested and architecturally justified.
- If a strategy needs extra series, prefer general-purpose derived fields that other strategies can reuse.
- `additionalIndicators.baseContext` is the canonical current shared indicator snapshot for runtime AI/gate/Telegram/prompt logic.
- `signal.indicators` is the historical indicator/series transport for backtest, replay, and ML transforms. Do not treat it as the primary current-value source for AI/runtime decisions when `baseContext` is available.
- Avoid current-value fallback chains from `additionalIndicators.baseContext` back to legacy flat fields; migrate call sites to the canonical context instead.
- Keep base-context volatility logic in `packages/core/src/utils/indicatorBaseContextVolatility.ts`; do not inline new volatility helpers back into `indicatorBaseContext.ts`.
- Base shared context should stay grouped by purpose:
  - `raw`: current MA / ATR / BB / OBV / price stats / levels / BTC correlation / venue spread
  - `regime`: trend, volatility, and momentum state
  - `structure`: level distance, range position, breakout/rejection state
  - `participation`: volume, turnover, OBV slope, effort-vs-result
  - `relative`: BTC relative strength and benchmark MA bias
  - `derivatives`: Coinalyze-derived positioning summary
  - `mtf`: compact MTF candle snapshots

### Market Context / Timescale

- Timescale bulk upserts must stay below PostgreSQL bind-parameter limits. Use the existing chunking pattern in `packages/infra/src/timescale.ts` for market trade flow, order book depth, and market breadth rows instead of building one huge INSERT.

### Signals / Backtest Parity Rules

- `yarn signals` evaluates only the last closed candle; do not include the still-forming newest candle in strategy decisions.
- `yarn signals` is the one-shot/manual runtime path. `yarn signals:daemon` is the long-running production path and must preserve keyed StrategyAPI state only for the next sequential closed candle.
- Do not retain a full strategy runtime or indicator controller per symbol/strategy in the signals daemon. Runtime wrappers and indicator history are disposable per evaluation; only bounded detector state from `createStateController` may survive between cycles.
- Keep the production daemon heap bounded through `SIGNALS_DAEMON_HEAP_MB` and retain its per-cycle RSS/heap/state-key log line when changing process supervision.
- The signals daemon must rebuild a strategy from the rolling warmup history after restart, a candle gap, an effective config change, or its bounded live-bar limit. Catch-up recovery must not place historical orders or send historical notifications.
- Runtime lifecycle identity includes connector, symbol, interval, strategy, and the effective per-symbol config (`user strategy config` plus results config). Removed tickers or strategies must be evicted from the in-memory lifecycle.
- Do not add Redis strategy-state persistence unless every participating engine exposes a complete versioned transition checkpoint and restore path. Diagnostic `getState()` snapshots are not sufficient checkpoints.
- AI/ML/gate approval decisions must be strictly signal-time causal. `yarn signals`, `yarn backtest`, `yarn replay`, and `ai-train --localOnly` must decide from data available at the signal candle decision time, not from later execution or outcome fields.
- Delayed-entry execution telemetry such as `backtestExecution.executionPrice`, `entryDelayMoveBps`, delayed entry timestamps, realized exit reason, or final trade result may be exported and analyzed after the fact, but must not be used as inputs to AI-gate approval, deterministic quality, or prompt-time decision context for the same signal.
- `BACKTEST_ENTRY_DELAY_BARS` may change fill timing, execution price, and PnL. It must not change the signal-time gate decision unless an equivalent live/runtime pre-entry re-evaluation path exists and is used by both `yarn signals` and `yarn backtest`.
- `yarn signals` runs on a separate runtime server in the current production workflow. The local Redis in this checkout is not the source of truth for live runtime signals, runtime signal evaluations, or runtime trade records unless the user explicitly says they synced/copied runtime data locally.
- Do not conclude that a strategy did not run in live runtime just because local Redis has no `users:root:runtime:signals:*` or `users:root:runtime:signal-evaluations:*` keys. Ask for or inspect the remote runtime server data/artifacts when live-runtime evidence is required.
- `yarn signals` runs over the full active ticker universe by default; use explicit ticker filters only when the task asks for a narrowed run.
- Keep `yarn backtest`, `yarn replay`, and `yarn signals` using the same strategy runtime path where practical. Avoid separate indicator or AI/ML payload logic for only one execution mode.
- Backtest indicator warmup may use cached coverage, but replay must resume from the actual restored checkpoint timestamp, not from the end of a coverage-only prefix. Coverage rows without a matching checkpoint are not a complete runtime state.
- BTC reference series used for relative strength or venue spread may be passed as the full aligned available series, but consumers must resolve values at or before the evaluated candle timestamp to avoid lookahead.
- When checking indicator correctness, compare `additionalIndicators.baseContext`, `signal.indicators` history arrays, and ML/AI payload builders separately; they have different purposes and should not be collapsed into one transport.
- Runtime signal code is split across `packages/cli/src/lib/signals/runtimeStrategies.ts`, `packages/cli/src/lib/signals/evaluations.ts`, `packages/cli/src/lib/signals/skipStats.ts`, and `packages/cli/src/lib/signals/telegram.ts`; inspect these helpers before changing `packages/cli/src/scripts/signals.ts`.
- Detailed runtime signal evaluations are stored for signal/error paths, while skip-heavy evidence may be available only through runtime skip stats unless detailed data was explicitly captured. Do not treat missing detailed skip records as proof that evaluation did not happen.

### Replay / Runtime Diagnostics

- `yarn replay` stores replay results under `users:<user>:backtests:results:replay:<timestamp>` and includes `runtimeComparison` details when runtime compare is enabled.
- When local runtime trades are unavailable, replay comparison falls back to direct exchange entry comparison (`getEntryExecutions` / `getClosedPnl`). In that mode, `RT PNL=0.00$` can mean closed PnL was unavailable from the exchange response, not that realized PnL was actually zero.
- Replay/runtime matching compares expected backtest entries against runtime or exchange entries with an entry timestamp offset of one replay interval. Inspect `packages/cli/src/lib/replay/runtimeComparison.ts` and `packages/cli/src/lib/runtimeParityDetails.ts` for matching, nearest-candidate, slippage, and mismatch-drilldown behavior.
- Use mismatch drilldown classifications carefully:
  - `gated_or_policy_blocked` means a signal/evaluation existed but AI/ML/policy/order status blocked entry.
  - `completed_signal_without_match` means an order path completed but no matching replay/backtest entry was found within tolerance.
  - `no_runtime_evaluation` means no local runtime signal/evaluation was available to the comparison; in this environment, that may simply reflect that live `yarn signals` runs on another server.
- Replay matched details already calculate entry/exit price deltas and slippage cost. Prefer inspecting those fields before adding a broad backtest slippage assumption.

### Plugin Rules

Expected public plugin exports:

- strategy plugin: `strategyEntries`
- indicator plugin: `indicatorEntries`
- connector plugin: `connectorEntries`

Project-level registration goes through `tradejs.config.ts` using:

- `strategies`
- `indicators`
- `connectors`

Default preset:

- `basePreset` from `@tradejs/base`

### Shared Strategy Helpers

- TrendLine and ReverseTrendLine share guardrail logic through `packages/strategies/src/shared/trendlineGuardrails.ts`; change shared trendline guardrail behavior there unless the divergence is intentionally strategy-specific.
- Shared risk helpers live in `packages/strategies/src/shared/risk.ts`; prefer them over duplicating strategy-local risk math.

## External User Reality Check

Before documenting or implementing an external-user flow, verify that it truly works outside the monorepo.

Examples:

- `@tradejs/app` and `@tradejs/cli` are publishable packages and should be treated as external entrypoints.
- `examples/sandbox` is intentionally outside the workspace graph and should continue consuming published `@tradejs/*` packages from npm rather than local workspace sources.
- If an npm flow does not work, do not paper over it in public docs.

## Development Commands

Use the existing scripts from root `package.json`.

Common internal commands:

- `yarn dev`
- `yarn infra-up`
- `yarn infra-down`
- `yarn doctor`
- `yarn build:ci`
- `yarn ai-pocket-search`
- `yarn backtest`
- `yarn results`
- `yarn signals`
- `yarn signals:daemon`
- `yarn bot`
- `yarn build`
- `yarn lint`
- `yarn typecheck`
- `yarn unit`
- `yarn prettify`

Sandbox:

- `yarn sandbox:install`
- `yarn sandbox:infra-up`
- `yarn sandbox:e2e`
- `yarn sandbox:infra-down`

Publishing:

- `yarn publish:packages:dry`
- `yarn publish:packages`
- `yarn bump:packages patch|minor|major|<version>`

## Testing Expectations

Minimum relevant checks:

- `yarn lint`
- `yarn typecheck`
- `yarn unit`
- `yarn checks` is the preferred umbrella verification when practical

Verification deduplication rule:

- if `yarn checks` was run successfully for the current diff, do not also run its constituent verification commands separately just to repeat the same coverage
- use targeted commands like package-local `typecheck`, specific `jest` paths, or standalone `yarn prettify` only when narrowing down a failure, preflighting a risky change before the full run, or verifying a package in isolation by explicit need

For public docs/site changes:

- make the change in `TradeJS-Docs` or `TradeJS-Site`, not in this monorepo
- run the relevant build in that external repo when practical

For package boundary / import refactors:

- run at least `yarn typecheck`, `yarn build`, and `yarn unit`
- for package-local moves, also run the affected package build/tests directly when practical

For app/runtime changes:

- prefer verifying `yarn build`
- if docs mention a runnable flow, verify the flow is actually supported

For sandbox changes:

- verify `yarn sandbox:install`
- run `yarn sandbox:e2e` when infra is available
- do not re-couple sandbox to workspace-local package sources

## AI Discovery Files

Public web surfaces also include AI discovery assets:

- `TradeJS-Site/public/llms.txt` in `TradeJS-Dev/TradeJS-Site`
- `TradeJS-Site/public/llms-full.txt` in `TradeJS-Dev/TradeJS-Site`
- `TradeJS-Docs/static/llms.txt` in `TradeJS-Dev/TradeJS-Docs`
- `TradeJS-Docs/static/llms-full.txt` in `TradeJS-Dev/TradeJS-Docs`

Keep them aligned with:

- current public package boundaries
- current docs URLs
- current external install flow

## ML Workflow Notes

### Professional core research contour

- Use `yarn research:core` and `CORE_RESEARCH.md` for every new core
  control-versus-candidate hypothesis. Preregister one causal mechanism,
  ordered-universe checksum, full resolved configs plus canonical hashes,
  immutable window/costs, target direction, hypothesis family, explicit stage,
  selection rules, and variants before running a screen.
- Treat `data/research/core/<researchId>/spec.json` as immutable. A changed
  hypothesis, config, export lineage, or decision gets a new `researchId`.
  Preserve rejected trials in the append-only hash-chained family ledger so
  multiple-testing correction includes the full denominator.
- Use `stage=screen|isolated_long|confirmation`, require parent research IDs
  for later stages, and regenerate `yarn research:core index`. Never infer a
  stage from period length, artifact names, or the presence of a run ID.
- A selection result is valid only after one-config run manifests complete and
  export N/W/L/PnL reconcile with Redis. Review matched/control-only/candidate-
  only identities, signal-time regimes, ALL/LONG/SHORT metrics, folds,
  bootstrap, overfitting diagnostics, cost stress, and the evidence matrix.
- Add `--researchTrace` only when setup/entry/skip attribution is needed. It is
  compact opt-in telemetry and must not change decisions. Completed AI rows
  carry deterministic setup identity; trace aggregates skips rather than
  logging every candle.
- `report.html` is an inspection artifact. `result.json`, `spec.json`, manifest
  hashes, normalized `trades.jsonl`, and the ledger are authoritative. Run
  `yarn research:core verify --spec <path>` before handoff.
- Treat the research contour as a public testing seam. After changing its spec,
  ingest, metric, comparison, statistical guardrail, reconciliation, trace,
  report, or orchestration behavior, run `yarn research:core:test` and
  `yarn research:core:coverage`. The latter enforces the contour's checked-in
  coverage floor. Test observable specs/results/artifacts and decisions; mock
  only true system boundaries such as Redis, process execution, time/randomness,
  or the filesystem. Do not couple tests to internal call order.
- Keep JSONL ingest single-pass: update the SHA while streaming and parsing rows.
  Do not add a separate full-file read or retain raw rows in memory. Reject a
  completed trade row without a stable signal identity. Full normalized trades
  may remain in memory because chronological portfolio metrics and causal setup
  matching require them.
- Reuse chronologically ordered trade arrays in metric/report paths; sort only
  after detecting an inversion. Group regimes in one pass. Write normalized
  `trades.jsonl` and large matched-pair artifacts through a backpressure-aware
  stream rather than constructing one export-sized string.
- Keep report rendering bounded independently of metric precision. HTML/SVG may
  downsample only the visual curve while preserving endpoints and local extrema;
  never downsample `result.json`, normalized `trades.jsonl`, reconciliation, or
  selection inputs. `report.html` remains non-authoritative.
- Use the shared threshold-rule evaluator for full, terminal, and cost-stress
  checks so null and infinite-PF semantics cannot drift. Enforce terminal cadence
  floors for every preregistered terminal window even when `terminalRules` is an
  empty list.
- Calendar-cluster bootstrap must span the full immutable experiment window,
  including zero-trade clusters. Do not condition uncertainty estimates only on
  active days. Treat CSCV/PBO as unavailable when candidate fold vectors are
  identical and no selection ranking exists.

### Strategy release and prospective diagnosis

- Use `.codex/skills/strategy-release/SKILL.md` to evaluate one frozen core plus
  deterministic AI-gate composition or diagnose that exact composition live.
  This contour is strategy-local; portfolio allocation and daily-loss policy are
  out of scope. `MAX_LOSS_VALUE` remains user-selected.
- Bound release research to at most three preregistered causal families, five
  variants per family, one isolated-long finalist, and one deterministic gate
  tuning round. Every historical comparison uses `--cacheOnly` over the maximum
  common cached half-open window for the frozen ordered universe.
- For the final composition, always produce one full-statistics matrix for
  trailing 1095d, 1460d, 1825d-or-exact-maximum-available, 365d, 180d, 90d,
  30d, and 7d. Record requested and covered days when the maximum cache is
  shorter than five years. Every window includes ALL/LONG/SHORT N, PnL,
  PnL/trade, PF, WR, realized MaxDD, and cadence.
- Before a release verdict, compare raw-core and gate-approved ALL/LONG/SHORT.
  If the current gate approves zero or negligible support from a profitable raw
  side, the single gate round must test exactly five preregistered
  direction-aware repair variants (control, side pass-through, causal side
  pocket, protected side pocket, direction-aware replacement). Do not reject a
  strategy merely because its current gate discarded an existing side edge.
- In release gate discovery, reserve the chronological test tail with
  `ai-pocket-search --testSplit <ratio> --sealTest`. Discovery may retain only
  the sealed tail's bounds/counts; open its economics exactly once after the
  five gate variants are frozen in the permanent ablation spec. An already
  exposed test is permanently historical evidence and cannot support
  `READY_FOR_RUNTIME` in that lineage.
- A recent failing direction gets at most one repair round, and only with at
  least 20 independent target-side trades, a preregistered causal signal-time
  mechanism, an untouched evaluation tail, and no prior repair. Do not fit a
  condition to a sparse/exposed 30d or 7d loser set; retain the long-window edge
  and move it to prospective micro-forward evidence instead.
- End every completed release research run with full-export
  `yarn ai-train --localOnly --chart -n 0` and persist/hash its structured
  output plus chart lineage. A missing or different-lineage chart blocks a
  forward action. Then run `yarn strategy:release decide`; never leave the next
  action as an unbounded “wait”.
- The `strategy:release decide` input must point to the structured chart report
  by path and SHA; the command must recompute and validate that artifact rather
  than trust a self-declared checksum. Represent a forward target by exact
  user/deployment/account/strategy-config identity, never by a resolved boolean.
- When the user has explicitly authorized automatic forward testing, the exact
  frozen candidate may start only on the resolved forward account/deployment at
  `MAX_LOSS_VALUE=1`. Preserve both directions, logic fingerprints, immutable
  evidence, and risk-scale history. This authorization does not permit
  promotion, risk increases, unrelated runtime edits, manual orders, or a
  production-daemon launch on an ambiguous target.
- Build equal-length historical drawdown envelopes with
  `yarn strategy:release profile` from the finalist's normalized
  `trades.jsonl`. Freeze the prospective closed-trade floor, minimum parity
  ratio, maximum order-failure rate, core/gate expectancy, and overfit estimate
  plus minimum causal-regime coverage in the release manifest; do not diagnose
  against mutable thresholds.
- `yarn strategy:release create` must independently hash and semantically
  validate every referenced artifact, derive gate results from the measured
  core/gate/parity/execution payloads, and reject draft booleans that disagree.
  Missing, invalid, unreconciled, or incomplete evidence takes
  precedence over an economic verdict and yields `INSUFFICIENT_EVIDENCE`.
  `READY_FOR_RUNTIME` is advisory and never authorizes runtime config writes,
  `MAX_LOSS_VALUE` changes, orders, daemons, deployment, or promotion.
- In prospective diagnosis, establish immutable lineage and runtime/replay/
  execution parity before economic attribution. A material known mismatch is
  `RUNTIME_DIVERGENCE`; an adequately supported comparable loss inside the
  frozen equal-length envelope is `EXPECTED_DRAWDOWN`; an adequate comparable
  breach is `GENERALIZATION_FAILURE`; unresolved completeness stays
  `INSUFFICIENT_EVIDENCE`.
- Scope every runtime scorecard to exactly one strategy and bind it to the same
  release-manifest strategy before diagnosis. A generalization subtype requires
  prospective shadow-raw-core expectancy, deterministic-gate expectancy, and
  causal regime coverage; do not guess a subtype when those books are missing.
- Require one clean logic lineage across every scoped evaluation, signal, and
  trade. Compare composition id (when bound), git SHA, effective runtime logic
  config, gate, and context with the frozen manifest. Track `MAX_LOSS_VALUE` as
  a separate immutable risk-scale lineage: a change alone does not invalidate
  logic evidence, but PnL/drawdown must be normalized by the runtime/release
  scale ratio. Missing or invalid risk scale blocks economic attribution as
  `INSUFFICIENT_EVIDENCE`; missing, dirty, conflicting, or different logic
  lineage is `RUNTIME_DIVERGENCE`.
- Keep micro-live, shadow composition, shadow raw core, and gate-comparison
  evidence distinct. LLM comparison defaults to AI-approved candidates only and
  is advisory; persist disagreements without letting the LLM affect deterministic
  trading decisions.
- Publish G/L/E/D/P/R chart events only through checksum- and artifact-id-
  verified marker envelopes. Producers and the app must share
  `@tradejs/infra/strategyReleaseEvidence`; missing or invalid evidence has no
  mutable Redis fallback. Dashboard binding requires the exact composition id
  or complete matching git/config/gate/context logic lineage; a
  config-only card must show missing evidence.
- Retention defaults to 3 days for operational Redis evidence, 14 days for
  verbose payloads, 90 days for verified aggregate bundles, and permanent
  compact ledgers/manifests/outcomes/disagreements/markers. Cleanup is dry-run
  unless `--apply` is explicit and never deletes unverified or unaggregated
  evidence.
- Treat release manifests, monitoring profiles, diagnosis decisions, marker
  envelopes, retention plans, and dashboard timeline normalization as public
  testing seams. Prefer contract-level tests; mock only filesystem, time,
  process execution, Redis, or other true boundaries.

Keep these conventions stable unless explicitly changing the ML pipeline.

- Use `yarn ml-train:latest -- --strategy <Strategy> --model <model>` for model training; legacy `ml-train:trendline:*` package scripts are not CLI dispatch commands.
- Backtest workers write chunked JSONL files:
  - `ml-dataset-[strategyName]-[chunkId].jsonl`
- `yarn ml-export` merges chunk files to canonical JSONL export.
- Training consumes base JSONL exports, not derived split files.
- Feature-window parity must remain consistent between backtest write path and inference path.
- Keep causality guards intact unless explicitly debugging.
- For all future backtest/config research sweeps, set `MAX_LOSS_VALUE` to `10` when the config includes that field.
- When updating a backtest `:ai` config, enable both `LONG` and `SHORT`; let the AI gate disable a side later if needed.
- When a symmetric core/lifecycle candidate improves only one direction, keep
  the rejected aggregate experiment and create a separate direction-specific
  follow-up with explicit `_LONG` and `_SHORT` parameters. Keep both sides
  enabled in the combined config, compare it with the same control, and do not
  infer the mixed-side result by silently promoting a global parameter.
- In backtest research and result summaries, report average trade PnL as
  `PnL/trade = total PnL / completed trades`. Do not present the CLI progress
  `avg` as PnL/trade: that value is average PnL per completed test/symbol. Keep
  it only when explicitly labelled `PnL/test` or `PnL/symbol`; use `n/a` for
  PnL/trade when there are no completed trades.
- Every core/backtest report must show three cohorts in this fixed order for
  every reported config and window: `ALL (aggregate portfolio)`, `LONG`, and
  `SHORT`. Show `N`, `PnL`, `PnL/trade`, `PF`, `WR`, `realized MaxDD`, and
  `cadence/day` for each cohort. `N` is completed trades; `PnL` is summed net
  realized trade PnL; `PF` is gross winning PnL divided by absolute gross
  losing PnL; `WR` is winning trades divided by `N`; `realized MaxDD` is the
  maximum peak-to-trough decline of the cohort's chronological completed-trade
  net-PnL equity curve; and `cadence/day` is `N / exact calendar days`.
  Calculate each directional cohort by filtering trades before computing its
  metrics. Calculate aggregate `PnL/trade` as
  `(LONG PnL + SHORT PnL) / (LONG N + SHORT N)`, never as the unweighted average
  of the two side averages. Label directional drawdown explicitly as
  `side-only realized MaxDD`: its time-ordered equity contains only that side's
  completed trades. Label `ALL` drawdown as `aggregate portfolio realized
MaxDD`; do not substitute one for the other. Assign and report baseline or
  candidate status separately for `ALL`, `LONG`, and `SHORT`; never infer a
  side status from the aggregate status.
- Keep both `LONG` and `SHORT` enabled throughout raw-core research and in the
  resulting core config. Do not silently disable, omit, or hide a negative
  direction. The later AI-gate stage evaluates the reconciled LONG and SHORT
  cohorts separately and may apply an explicit direction-aware gate; it does
  not retroactively change the raw-core report.
- For a direction-targeted hypothesis, preregister the target side, the
  supposedly unaffected side, and the matched-control acceptance rule before
  running it. Judge the causal hypothesis primarily on the target cohort:
  require the preregistered improvements in `PnL`, `PnL/trade`, `PF`, `WR`, and
  `side-only realized MaxDD` (a smaller drawdown is better). Require exact
  signal/trade identities and exact `N` on the non-target side, plus equal
  `PnL` within only the documented reconciliation-rounding tolerance, only
  when the architecture makes that side invariant. If shared position
  occupancy, cooldown, order lifecycle, or another interaction can change the
  non-target side, explicitly report occupancy spillover (added/removed trade
  identities, `N`/cadence, and all economic-metric deltas) and require its
  preregistered non-regression rule instead of claiming identity. Evaluate
  aggregate portfolio PnL and aggregate portfolio realized MaxDD as separate
  promotion guardrails. An aggregate failure can block config promotion, but
  it must not be folded into the target-side causal verdict or used alone to
  conceal a side improvement or regression.
- In full-universe backtest research, define portfolio cadence as completed
  trades divided by the exact requested calendar days. Do not divide it by the
  number of tested symbols. Do not extrapolate a full-universe cadence to an
  approximate exchange symbol count. For a deliberately sampled universe,
  any linear universe projection must be reported separately from observed
  cadence, with the tested count, target count, and scale factor.
- Freeze one eligible ticker list, ordered-symbol checksum, exact start/end
  timestamps, config snapshot, and git lineage across a core robustness
  comparison. A mutable Redis universe or config key alone is not sufficient
  evidence. Record missing/error tests per config and never aggregate multiple
  grid `configId` buckets into one strategy result.
- Evaluate long-window core candidates on terminal `365d`, `180d`, `90d`, and
  `30d` half-open slices `[end - days, end)` anchored to the immutable backtest
  window end. Include zero-trade windows. A `--fast --ai` run may be used to capture raw core trade rows for
  this analysis because the BACKTEST entry policy does not apply the AI gate;
  document that distinction explicitly. Confirm shortlisted variants without
  `--fast`, then run standalone shorter horizons when reset/warmup sensitivity
  can change stateful strategy results.
- After a `--fast --ai` run, use reconciled completed-trade JSONL rows as the
  authoritative source for trade-level PnL, PF, PnL/trade, terminal windows,
  and realized portfolio MaxDD. Use Redis per-result `stat` for completion and
  N/W/L/PnL reconciliation; do not replace row-level totals with its aggregate
  when only per-symbol cent rounding explains a small PnL delta.
- Treat the standalone horizons as reset/preload sensitivity tests, not as
  substitutes for terminal slices of the same long run. If their metrics differ,
  investigate replay/state initialization and report both; do not choose the
  more favorable result.
- A multi-cell parameter family may use an all-universe 180d grid as a cheap
  first-stage screen. Label it selection-only, retain every cell, and rerun each
  shortlisted cell on the frozen long window before making any robustness or
  promotion claim. Do not optimize the short screen and report it as long-run
  stability.
- Run shortlisted long-window parameter cells as isolated single-config runs.
  Do not fan out several 1100d full-universe cells inside one worker group: it
  raises peak heap usage and can mix lifecycle/execution state when a strategy
  shares replay state under an incomplete config key. A multi-cell 180d screen
  is allowed only after proving per-config state isolation; otherwise split the
  screen into single-cell runs too. Treat OOM/partial manifests as failed runs
  and never derive aggregate or terminal metrics from their completed subset.
- Treat backtest worker parallelism as one host-wide budget, including runs
  launched by other agents or terminals. Before starting another full-universe
  run, count active tester workers and inspect memory pressure/swap; do not
  launch a third concurrent batch when two batches already create sustained
  pressure. Reduce `-p`, finish an active run, and let memory recover instead
  of relying on per-worker heap limits to prevent an OOM.
- A raw-core JSONL export is acceptance-grade only when its per-config
  N/W/L exactly reconcile with the complete Redis result stats and PnL differs
  only within the documented per-symbol rounding tolerance. Any missing row,
  duplicate conflict, partial manifest, or nonzero N/W/L delta invalidates its
  PF, PnL/trade, terminal windows, and portfolio MaxDD; fix the writer/export
  path and rerun rather than imputing missing outcomes.
- Never run `ai-export` against a backtest whose manifest is still `running`.
  Workers can still own open append streams after some checkpoint results are
  visible; merging or deleting those chunks creates a partial dataset. Keep
  source chunks by default, require a finished manifest, and perform cleanup
  separately only after exact Redis/export reconciliation.
- Treat a cadence floor such as `0.2/day` as a per-window requirement unless
  the research question says otherwise. At `0.2/day`, the minimum completed
  trades are 220/73/36/18/6 for 1100/365/180/90/30-day windows. Preserve failed
  hypotheses and their full resolved configs in immutable local research notes
  so future sweeps do not silently repeat them.
- Treat membership inputs selected outside price candles—wallet registries,
  top-symbol/perp universes, benchmark baskets, allowlists, and similar
  snapshots—as point-in-time data. A backtest may use only a version whose
  `effectiveFrom` is at or before the evaluated candle. Applying one current or
  future membership snapshot across older history is survivor/activity
  lookahead even when the selector excludes PnL. Mark long-window robustness
  blocked until effective-dated history exists; do not tune thresholds from the
  contaminated run.
- Label a core candidate `strictly robust` only when PnL is non-negative,
  PF is at least 1, and the cadence floor is met on the full window and every
  required terminal window. A still-negative strategy may be retained as an
  `improved research candidate` only when full-window PnL and PnL/trade improve
  over the frozen baseline, required-window cadence remains adequate, and the
  terminal-window/drawdown table makes every regression explicit. Do not call
  aggregate improvement stability when one terminal window collapses.
- Treat `runtime-parity` as core/backtest execution parity, not live AI/ML approval parity:
  - it replays in `ENV=BACKTEST` with order placement enabled and compares replayed entry orders to saved runtime trade records
  - `runtime=0` and `backtest=0` for a strategy means the selected replay targets produced no comparable entries in that window; it does not measure how many AI rows would be approved
  - if AI/ML gates matter, inspect runtime signals/evaluations or run `ai-train` separately
- Treat `ai-train` approved cadence metrics as historical dataset averages over selected rows, not a guarantee of one live approved trade on every calendar day.
- Any claim about expected production cadence must include terminal dataset windows for at least the last `30d` and `7d`, anchored to the export maximum timestamp. Use `yarn ai-train ... -n 0`; its default terminal-window report also includes `90d`.
- Record the export minimum/maximum timestamps and data lag. If the export does not overlap the production period being discussed, report live cadence as unknown instead of extrapolating the full-history average.
- Compare runtime and `ai-train` gate behavior only when git SHA, gate fingerprint, config-id fingerprint, context fingerprint, `MIN_AI_QUALITY`, and the relevant context env agree. Treat a mismatch as a different experiment.
- A strategy release must also bind the canonical resolved core-config SHA-256 and exact core-export SHA-256. Keep AI-research config/context fingerprints separate from effective runtime config/context fingerprints; they hash different representations and must not be substituted for each other. Release evidence from another git/config/export/gate/context/MAX_LOSS lineage is invalid even when its file checksum and economics are valid.
- A zero-approval terminal window must be reported explicitly even when full-history cadence is healthy. Investigate top reject reasons and current feature availability before changing thresholds.
- After changing a deterministic AI gate, regenerate the terminal-window report and create a new `notes/<Strategy>/YYYY-MM-DD-<slug>.md` record with the resolved config and structured metric snapshot; old notes are not evidence for the new gate lineage.
- `ai-train --localOnly` replays the same local deterministic strategy AI gate used by `AI_MODE=gate`; it does not measure external LLM provider behavior.
- `yarn ai-pocket-search` is the preferred deterministic AI export pocket discovery tool before writing or tuning new AI-gate rules. It reconstructs current strategy AI payloads, groups sharded merged exports, shows progress bars, and writes Markdown reports to `data/ai/output` by default.
- `ai-pocket-search` excludes outcome fields and current deterministic gate output fields from candidate features by default; use `--includeGateContext` only when explicitly auditing existing gate decisions, not when discovering future approval rules.
- `ai-pocket-search` uses time-ordered holdout validation by default (`--validationSplit 0.25`) and deduplicates equivalent row-selection pockets. Prefer pockets that survive validation, not only high train PnL; use `--validationSplit 0` only for legacy full-sample exploration.
- Treat `AI_MODE=gate` metrics as directly comparable to `ai-train --localOnly`, because both use the local deterministic strategy AI gate with the same `MIN_AI_QUALITY` threshold.
- Do not present `ai-train --localOnly` results as `AI_MODE=llm` expectations; `AI_MODE=llm` depends on external model decisions and must be validated from normal `ai-train`, live runtime records, or another replay that actually includes provider output.
- When reporting approved quality metrics, use `qN+` to mean the effective `MIN_AI_QUALITY=N` live stream, which includes every approval with quality `>= N`.
- Do not present plain `q1` / `q2` / `q3` / `q4` / `q5` as the default approved bucket labels unless the user explicitly asks for the isolated subset; default reporting should use `qN+` notation.
- To compare `AI_MODE=gate` and `AI_MODE=llm`, use live/runtime signal analysis records or explicit replay artifacts that contain both gate and LLM decisions.
- TrendFollow and TrendShift AI gates have recent strategy-specific guardrail tuning; inspect their `guardrails.ts`, `adapters/ai.ts`, and tests before changing thresholds or interpreting qN+ metrics.
- In derivatives gate code, top-level derivatives context is BTC benchmark context. Use `targetContext` / `targetDerived` only for explicitly target-symbol features, name variables accordingly, and treat switching an existing gate from benchmark to target context as a behavior change requiring a new export and validation.
- `DERIVATIVES_CONTEXT_TARGET_ENABLED=false` is a strict data-shape contract in both signals and backtest: never populate `targetContext` or `targetDerived`, even when the target symbol is present in Timescale or in `DERIVATIVES_CONTEXT_EXTRA_REFERENCE_SYMBOLS`. Such symbols may remain available only under `referenceContexts`.
- TrendLine core/runtime config uses `TRENDLINE`; `TRENDLINE_CONFIG` is used in ML payload/training contexts. When applying backtest or result configs to a live/replay strategy config, make sure detector options land in `TRENDLINE`, or the core may run with stale/default trendline detector settings.
- Strategy backtest/config work has a dedicated local skill at `.codex/skills/strategy-backtest-research/SKILL.md`. Use it for strategy implementation, figures, cache-only backtest sweeps, and year-scale `--ai` export prep.
- Local deterministic AI gate research has a strategy-neutral skill at `.codex/skills/ai-train-local-research/SKILL.md`. Use it for `yarn ai-train --localOnly`, `yarn ai-pocket-search`, qN+ metrics, drawdown/winrate reporting, direction/time/symbol stability checks, pocket discovery, and gate-vs-LLM analysis.

## Generated / Build Files

- Do not rely on generated files as source of truth.
- Do not commit `dist` assumptions into architectural decisions.
- If build tools regenerate files like `next-env.d.ts`, treat that as expected generated output.

## Editing Policy

- Keep diffs focused.
- After any code changes, run `yarn prettify` before further verification or committing.
- Do not rewrite unrelated formatting.
- Do not change public APIs without explicit intent.
- Do not add backward-compat fallbacks unless requested.
- Prefer clear architectural cleanup over transitional indirection when the user explicitly asks for clean breaking refactors.

## When Updating Root Markdown

Use root markdown files for internal repo guidance:

- `README.md` — repository overview and internal workflows
- `QUICKSTART.md` — internal developer startup flow
- `STRATEGY_API.md` — strategy contract and runtime behavior

Keep them aligned with:

- current package boundaries
- actual import policy
- actual runnable commands

## When Unsure

- Prefer the current code and root markdown over stale assumptions.
- If public docs and actual package behavior disagree, trust the package behavior and fix the docs.
- If a flow only works inside the repo, document it only in root markdown, not in `TradeJS-Docs`.
