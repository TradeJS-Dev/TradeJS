# Portfolio policies: internal execution contract

`PORTFOLIO_POLICY` is opt-in strategy configuration. Its absence preserves the
existing execution path. Strategies still produce ordinary entry/exit decisions.
Do not implement account state, reservation counters or exchange IO in cores.

```ts
PORTFOLIO_POLICY: {
  id: 'portfolio-v1',
  scope: 'strategy', // or 'account', or { strategies: ['DoubleTap', 'TrendLine'] }
  riskUnit: 10,
  observationIntervalMs: 300_000,
  maxPriceAgeMs: 300_000,
  maxPositions: 4,
  profitExit: { scope: 'basket', multiple: 2, minPositions: 2 },
  closeOppositeOnFill: true,
}
```

`riskUnit` is one fixed monetary R in USDT. Set it explicitly to the intended
`MAX_LOSS_VALUE`; a group with different position sizes still uses this one R.
A profit threshold is **gross unrealized** PnL, before commissions, funding and
closing slippage. Realized replay results continue to include execution costs.
A basket includes its losing positions and both directions. `scope: 'position'`
inside `profitExit` applies the threshold separately to each position.

The outer scope controls ownership: one strategy, a named strategy group, or
all journal-attributed positions in the bound account/deployment. Group members
must use identical policies. Unknown positions block new admissions; policies
never close unknown or foreign positions. This requires managed positions and
one entry per symbol; pyramiding/increase and entries without signals are
explicitly rejected when policies are enabled. Existing strategies using those
features remain compatible with policies disabled.

## Execution ordering

1. The shared replay advances every symbol in a market cycle, applying native
   SL/TP before invoking strategies. Runtime reads current exchange positions.
2. Reconcile pending submissions and confirmed fills. An order acknowledgement
   is not a fill. The first confirmed partial fill can trigger opposite exits;
   its remaining quantity keeps its reservation until a terminal observation.
3. Evaluate gross profit once per observation bucket. Require fresh, nonfuture
   prices of every basket member. Missing prices produce unknown PnL, not zero.
4. Persist close claims before IO. Keep entries blocked while any close is
   unresolved and through the remainder of the cycle that confirms closure.
5. Attach `additionalIndicators.portfolioContext` before ML/AI and admission.
6. Reserve capacity atomically immediately before execution, including delayed
   backtest entries. `beforeSubmit` persists normalized quantity before network
   submission. Pending submissions consume slots; partial positions do not
   consume a second slot. At a full cap an opposite entry is rejected too.
7. Reconcile the actual fill before requesting opposite closes. Existing
   `beforePlaceOrder` / `afterPlaceOrder` hooks retain their old semantics;
   `afterPlaceOrder` is not used as execution confirmation.

Profit monitoring runs on strategy market cycles even when cores return skip.
`observationIntervalMs` limits evaluation frequency; it does not create an
independent timer or manufacture missing market events. Compare replay/runtime
with the same observation schedule. Replay sorts/adopts its existing cycle
order; simultaneous live arrivals are serialized by reservation CAS, not by a
claim that real network arrival order is predictable.

When order execution is disabled (`MAKE_ORDERS`, external placement controls),
portfolio context is read-only and policies submit no closes. Manual entry
pause remains separate from exit management. Do not combine overlapping legacy
opposite/global-profit hooks with these policies.

## State and failures

`@tradejs/core/portfolio` owns pure validation, reconciliation and decisions.
`@tradejs/node/portfolio` coordinates observations, CAS reservations and closes.
The strategy runtime supplies exchange/journal or shared-replay adapters.
`@tradejs/infra/redis` persists runtime state; replay has isolated memory state.
There is no global mutable portfolio singleton or per-strategy copy of rules.

State is bound to user, connector, universe, account, deployment and scope.
The entire policy fingerprint must agree. Changing `id` cannot bypass an old
reservation. Reconcile persisted scope before changing an active policy.
Configuration remains Git-owned; Redis stores execution state only.

A definite pre-submission failure releases its reservation. Bybit terminal
order observations and explicit exchange rejection release rejected/cancelled
orders. Unknown status, missing execution history and timeouts never imply
rejection. An ambiguous reservation deliberately remains blocking across
restart until authoritative reconciliation; it has no automatic time expiry.
A process lost before submission can also leave an unresolved reservation.
Do not delete it on age alone. If a fill was never observed as a position and
has already closed, absence alone is insufficient to infer its lifecycle.

Close acknowledgement is not closure. Confirm disappearance through complete
position observations, retry unresolved closes on later fresh cycles, and
update the runtime journal only for the same owned position. Bybit position
observations exhaust pagination and fail on malformed active rows. Other live
connectors must supply fresh marked positions and entry execution observations;
unsupported combinations fail explicitly.

## AI gate and research

`portfolioContext` is a frozen pre-admission observation: position/pending counts,
long/short counts, gross unrealized PnL in R, loss at current stops relative to
entry in R, and largest entry-notional share. An unknown stop makes stop risk
unknown. Observation time and policy identity are metadata; price completeness
and unknown ownership are data quality. They remain available for audit but
are not automatically ranked as causal pocket inputs.

All inputs use the same registered feature projection, export and native
reconstruction as ticker profiles. Preserve the frozen snapshot even when a
strategy adapter removes verbose context. Never reconstruct portfolio features
from future trade outcomes or fill absent historical context with zeros.

These policies are path-dependent. Isolated per-symbol backtests are rejected:
use the existing shared portfolio replay connector and chronological market
cycles. Filtering a completed trade list is not a policy backtest. A different
AI gate changes later positions and portfolio features; evaluate the candidate
through shared replay, not by reusing the original state trajectory as if it
were unchanged. Existing isolated native ablation cannot establish portfolio
policy performance.

Verify capacity races, partial/failed/ambiguous submissions, restart, ownership,
stale/missing marks, losing basket members, no same-cycle reentry, SL/TP priority,
no-order mode, AI export/reconstruction and exact runtime/replay event parity.
Benchmark disabled policies against an immutable baseline; report enabled
policy cost separately and do not generalize one fixture to the entire market.

## Close permission and rejected submission retries

Automatic closes use the same project and strategy `beforeClosePosition` gate
as ordinary exit decisions, with the position owner's symbol/config and latest
available market context. A veto, hook failure or missing owner runtime prevents
submission. The durable close intent remains pending and admission stays blocked;
a later cycle may retry permission. Native exchange SL/TP is not a runtime hook.

Every authoritative Bybit rejection releases its capacity reservation, including
the first rejected maximum-quantity attempt. Before an automatic retry, capacity
is reserved again atomically; another entry may have taken the slot. Retried
portfolio submissions use a distinct order link ID, carried through the signal
and journal, so the previous rejection cannot reconcile the new reservation.
Failure during retry preparation leaves no submitted reservation. An unknown
network outcome still retains its reservation and is never retried blindly.


## Compare a candidate in the portfolio

Run the incumbent and the candidate via the existing replay with
`--cacheOnly --portfolioReport --portfolioBatchSize <universe-size>`.
Use explicit common bounds, the same cached inputs and risk, and one strategy
replacement in the research composition. Pass the incumbent JSON to the
candidate run using `--portfolioCompareTo <incumbent-report.json>`.
Both reports must record a single shared batch. A batched portfolio report
is an aggregate of separate simulations and cannot evaluate shared limits.
Replay rejects batching when portfolio policies are configured.

The comparison validates the incumbent checksum, recorded scope, strategy
order and risk/policies, then adds realized PnL/MaxDD deltas, recovery,
strategy contributions and a paired calendar bootstrap. Shared reports also
measure equity drawdown at cycle boundaries using last observed candle closes.
The displacement count includes identical signals of unchanged strategies that
filled in one run and were rejected by the position cap in the other. Missing
diagnostics are reported as null. Coverage summaries do not prove byte-level
identity of all market inputs. Freeze source data separately.
