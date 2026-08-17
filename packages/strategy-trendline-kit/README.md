# @tradejs/strategy-trendline-kit

Shared trendline payload and guardrail primitives for independently packaged
TradeJS TrendLine and ReverseTrendLine strategies.

```ts
import {
  buildTrendLineEvaluator,
  getTrendLineFromPayload,
} from '@tradejs/strategy-trendline-kit';
```

The package owns only the family contract for parsing and evaluating trendline
payloads. It does not contain either strategy's entry policy, risk model,
StrategyAPI calls, registry entries, or infrastructure.

Use `@tradejs/strategy-kit/*` for strategy-neutral authoring helpers. Keep
TrendLine- and ReverseTrendLine-specific decisions in their respective strategy
packages.
