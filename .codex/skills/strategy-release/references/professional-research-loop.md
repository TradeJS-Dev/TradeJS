# Professional algo-research loop

## Contents

1. Write the trading thesis
2. Build an opportunity map
3. Construct a hypothesis portfolio
4. Diagnose before adapting
5. Think in compositions
6. Make a professional decision

The workflow is a decision framework, not a compliance checklist. Behave like
the owner of the strategy's future expectancy: understand how the edge is
supposed to work, find where the realized process breaks, and spend the bounded
trial budget on the highest-information causal interventions.

## 1. Write the trading thesis

Before selecting variants, explain in plain language:

- who is expected to be forced or mispriced;
- what observable setup identifies that condition at signal time;
- why the proposed entry timing should improve price or confirmation;
- how the stop expresses thesis invalidation;
- how profit should be realized and why the target/trail is achievable;
- which market regimes should help or hurt;
- what cadence and event independence the mechanism can realistically support.

Compare this thesis with the current code, figures, traces, and realized trades.
List every semantic gap. A strategy with no defensible thesis is not rescued by
threshold search; use one bounded falsification family to test whether any edge
exists, then retire it if the mechanism remains unsupported.

## 2. Build an opportunity map

Decompose the performance failure across these intervention points:

1. **Opportunity formation** — too few/many raw setups, duplicated symbols per
   event, stale zones/pivots, universe or timeframe mismatch.
2. **Entry selection and timing** — premature entry, confirmation delay,
   distance/chase, quality/context discrimination, side asymmetry.
3. **Risk geometry** — stop not tied to causal invalidation, target unreachable,
   fee/slippage economics, position sizing inconsistency.
4. **Position lifecycle** — winners returned, losers held, wrong opposite exit,
   missing thesis-invalidation exit, occupancy/cooldown spillover.
5. **Regime and direction** — edge exists only in one side or causal regime;
   current gate hides it or mixes incompatible policies.
6. **Concentration and capacity** — one timestamp, symbol, sector, or correlated
   event supplies most PnL; event fan-out overstates independent support.
7. **Execution/parity** — delayed fills, protection, fees, runtime state, or
   package boundaries differ from the researched behavior.

For each point record evidence, estimated economic impact, independent support,
signal-time observability, implementation complexity, and a falsifying result.
Use `unknown`, not invented precision.

The opportunity map must identify:

- the largest loss budget that a causal intervention can plausibly remove;
- the strongest existing edge worth protecting;
- the main cadence bottleneck;
- the main tail/drawdown source;
- the cheapest experiment that distinguishes two competing explanations.

When one isolated global config change improves one side and worsens the other,
record a directional-parameter opportunity. Use the dedicated classifier and
[directional-parameter-split.md](directional-parameter-split.md) rather than
discarding the field, accepting the aggregate compromise, or duplicating every
parameter speculatively.

Persist and hash this map before round 1. Do not confuse a report containing
many metrics with a diagnosis that ranks actionable causes.

## 3. Construct a hypothesis portfolio

Choose three causally distinct families from the opportunity map, not from a
generic parameter menu. The portfolio must include these roles when possible:

- **Exploit** — preserve or amplify the strongest evidenced edge;
- **Repair** — attack the largest attributable loss or lifecycle failure;
- **Explore/falsify** — test a distinct market mechanism or the counter-thesis
  most likely to invalidate the current explanation.

Generate at least two candidate mechanisms for every role before choosing the
anchor. Rank them qualitatively by:

`expected economic impact × information gain × support ÷ complexity/risk`.

Do not pretend this score is statistically precise. Its purpose is to force an
explicit choice between meaningful experiments.

Good variants change one causal transition: setup formation, confirmation,
invalidation, payoff, exit, or gate decision. A bundle is allowed only when its
parts are inseparable for the thesis and a matching ablation is included.

Bad variants include:

- adjacent thresholds chosen only because a nearby value looked profitable;
- filters defined from exit reason, realized PnL, future regime, or delayed fill;
- broad indicator combinations without a market-mechanism claim;
- deleting a losing side from raw evidence;
- reducing cadence until a few correlated winners remain.

## 4. Diagnose before adapting

After each round, answer these questions before creating children:

1. Did the intended trace transition actually change?
2. Was the PnL delta caused by matched-trade improvement, removed losers, added
   winners, or occupancy spillover?
3. Is the improvement independent across events, symbols, folds, and regimes?
4. Did costs, drawdown, or tail losses move consistently with the thesis?
5. Which observation supports or falsifies the mechanism?
6. What is now the highest-value uncertainty?

Update a belief ledger for every family:

```json
{
  "family": "<id>",
  "priorClaim": "<causal claim>",
  "observations": ["<metric/trace/identity facts>"],
  "mechanismVerdict": "supported|falsified|inconclusive",
  "protectedEdge": "<edge the child must retain>",
  "remainingFailure": "<dominant failure>",
  "nextExperiment": "<single discriminating intervention>",
  "falsifier": "<result that retires the family>"
}
```

- If supported, refine the remaining failure without discarding the protected
  edge.
- If inconclusive, prefer an ablation or higher-information contrast over a
  smaller threshold nudge.
- If falsified, change mechanism or retire the family; do not rescue the label.

Outcome-derived cohorts may diagnose where money was lost. Translate them into
a signal-time observable hypothesis and validate it on a later partition; never
turn the outcome cohort itself into a filter.

## 5. Think in compositions

The product is core plus deterministic gate, not a raw-core beauty contest.

- A high-cadence weak core may be valuable if a causal gate retains enough
  independent positive events.
- A profitable but sparse gate is a clue, not a release: identify why it wins,
  widen support through causal neighboring setups, or preserve it as one sleeve
  of the same strategy composition.
- A profitable direction mixed with a losing direction requires the explicit
  direction-policy checkpoint.
- A recent regime pocket may justify micro-forward monitoring, but never a
  silently fitted historical rule.

Optimize expectancy, independent-event support, drawdown, and executable
cadence together. Never maximize PnL alone or cadence alone.

## 6. Make a professional decision

At every checkpoint choose one concrete action:

- run the next highest-information experiment;
- repair invalid evidence and rerun;
- carry a side-qualified candidate into gate research;
- select one immutable prospective composition;
- start/prepare the authorized risk-1 micro-forward;
- retire a falsified family with a stated reason.

Do not answer with a passive blocker when a safe in-scope experiment can reduce
the uncertainty. Do not build unrelated infrastructure merely because it would
make the study ideal. Add infrastructure only when it is the smallest path to
distinguish candidates or establish runtime parity.

The final narrative must say what was learned about the market mechanism, not
only which thresholds won.
