---
title: Redis Data Model
---

Redis is used as an operational storage layer for runtime state, configs, and transient artifacts.

## Main Key Families

- Users: `users:index:<user>`
- User strategy configs: `users:<user>:strategies:*:config`
- Backtest configs: `users:<user>:backtests:configs:<config>`
- Backtest artifacts:
  `users:<user>:tests:<strategy>:<testName>:(config|stat|orders)`
- Signals and signal indexes (symbol-oriented keys)
- Runtime AI analysis: `analysis:<symbol>:<signalId>`
- Backtest worker chunks, temporary stats, and test artifacts

## TTL Strategy

TradeJS uses mixed persistence:

- some keys are short-lived (cache/test runtime),
- some keys are medium-lived (signals/history windows),
- config keys are intended to stay durable.

## Operational Rules

- Never flush Redis in production without a scope.
- Prefer scoped cleanup commands (`yarn clean-redis` with area).
- Treat Redis as live runtime dependency; monitor availability and latency.

## Debug Tips

- Start with key patterns used by the failing feature.
- Compare expected symbol/user namespace with real keys.
- If signals are missing, inspect both signal keys and strategy config keys.
