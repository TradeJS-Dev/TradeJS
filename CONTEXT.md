# Strategy Research

TradeJS terminology for producing and validating a deployable trading strategy from causal core logic, an AI gate, and prospective runtime evidence.

## Language

**Strategy Composition**:
The exact versioned pair of a raw-core strategy configuration and a deterministic AI-gate configuration that is researched, promoted, and monitored as one unit.
_Avoid_: Strategy, model, candidate when the core/gate lineage is not explicit

**Economic Mandate**:
The frozen strategy-local acceptance constraints for a Strategy Composition, including its user-selected MAX*LOSS_VALUE, required evidence, runtime parity, execution assumptions, and acceptable historical drawdown envelope.
\_Avoid*: Good metrics, profitable enough

**MAX_LOSS_VALUE**:
The user-selected nominal loss budget used to size one strategy trade. It is the only risk limit owned by Strategy Release; daily loss protection remains an external Bybit control.
_Avoid_: Portfolio risk limit, guaranteed maximum loss

**Forward Incubation**:
A prospective live stage in which a frozen Strategy Composition trades with its user-selected MAX*LOSS_VALUE and produces immutable runtime, execution, and outcome evidence without being retuned.
\_Avoid*: Paper backtest, continued optimization

**Strategy Release Verdict**:
The terminal result of researching one Strategy Composition: ready for runtime, unsuitable for the current market, or insufficient evidence, with the exact blocking evidence and next action.
_Avoid_: Best config, promising strategy

**Strategy Release Manifest**:
The checksum-protected terminal record that binds one Strategy Composition to its cached market window, research budget, verified evidence, monitoring profile, and Strategy Release Verdict.
_Avoid_: Deployment config, latest report

**Monitoring Profile**:
The frozen equal-length historical drawdown envelopes, baseline core/gate expectancy, sample floor, parity/order-failure and regime-coverage thresholds, and overfit diagnostic used to interpret later prospective outcomes without retuning the composition.
_Avoid_: Live threshold, adaptive risk rule

**Strategy Release Skill**:
The repository-local Codex workflow with `release` and `diagnose-live` modes that improves and validates one Strategy Composition or explains why it should not be released.
_Avoid_: Portfolio optimizer, autonomous trading agent

**Research Budget**:
The fixed search allowance for one Strategy Release run: at most three causal hypothesis families, five variants per family, one isolated-long finalist, and one AI-gate tuning round.
_Avoid_: Keep tuning until profitable

**Available Candle Window**:
The maximum half-open historical window already covered by the local candle cache for the frozen universe. Strategy Release backtests use it only through `--cacheOnly` and never download missing history.
_Avoid_: Fixed 1100-day window, all possible market history

**Evidence Book**:
One synchronized prospective record for a frozen Strategy Composition: micro-live executions, shadow composition outcomes, shadow raw-core outcomes, or AI-gate versus LLM-gate decisions.
_Avoid_: Log stream, latest metrics

**Gate Disagreement**:
A signal-time observation in which the deterministic AI gate and the versioned LLM gate produce different approval decisions for the same core candidate.
_Avoid_: Model error, contradiction without matched lineage

**LLM Comparator Policy**:
The versioned sampling rule that decides which core candidates receive a shadow LLM decision. It initially covers AI-approved candidates only and may be changed without changing the trading Strategy Composition.
_Avoid_: LLM gate when the LLM cannot affect trading

**Advisory Feedback Loop**:
An automated process that validates prospective evidence and gives human-readable recommendations but never changes configurations, orders, or risk by itself.
_Avoid_: Auto-tuner, auto-promotion, automatic kill switch

**Composition Freeze**:
The boundary after which any change to core logic, resolved core config, gate logic, gate threshold, regime policy, or causal feature set creates a new Strategy Composition and prospective cohort.
_Avoid_: Minor live tweak, same experiment

**Composition Lineage**:
The complete immutable identity of one Strategy Composition: composition id,
clean git SHA, canonical core config and export SHA-256 values, deterministic
gate config-id/gate/context fingerprints, effective runtime config/context
fingerprints, and user-selected MAX_LOSS_VALUE. Evidence missing any required
identity is not comparable.
_Avoid_: Config hash, current strategy name, same code approximately

**Regime Attribution**:
Signal-time market-state labels retained for analysis, coverage, and drift diagnostics but not used to change the current Strategy Composition's trading decision.
_Avoid_: Regime filter, regime training

**Evidence Retention Policy**:
The configurable tiered lifecycle that keeps compact prospective lineage and decisions permanently while expiring reproducible operational payloads before they consume material disk space.
_Avoid_: Delete old logs, keep everything

**Immutable Evidence Marker**:
A chart event loaded from a checksum-verified evidence artifact and linked to its artifact identity, rather than reconstructed from mutable Redis lineage or current configuration.
_Avoid_: Inferred config-change line, best-effort marker

**Evidence Timeline**:
The verified chronological projection of composition, loss value, evidence, deployment, parity, and recommendation markers for one strategy chart; missing or invalid evidence remains explicit and has no mutable fallback.
_Avoid_: Redis lineage history, chart annotation

**Prospective Evidence**:
Evidence generated after a Strategy Composition is frozen, from decisions and executions that were not available while the hypothesis or gate was designed.
_Avoid_: Latest historical window, terminal slice

**Live Drawdown Diagnosis**:
An evidence-backed classification of a live drawdown as runtime divergence, historically expected drawdown, or strategy/gate generalization failure, with unknown retained when the evidence cannot distinguish them.
_Avoid_: Bad market, broken strategy without attribution
