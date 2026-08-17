# @tradejs/strategy-kit

Browser-safe, strategy-neutral helpers for independently packaged TradeJS
strategies.

The package has no root export. Import only the capability a strategy needs:

```ts
import { isDirectionAligned } from '@tradejs/strategy-kit/context';
import { buildEntryStopTargetFigures } from '@tradejs/strategy-kit/figures';
import { buildStructureRiskPlan } from '@tradejs/strategy-kit/risk';
```

Available public subpaths:

- `@tradejs/strategy-kit/context`
- `@tradejs/strategy-kit/figures`
- `@tradejs/strategy-kit/numbers`
- `@tradejs/strategy-kit/positions`
- `@tradejs/strategy-kit/risk`

The helpers contain no strategy registry, infrastructure, network, storage, or
order-placement code. Strategy packages remain responsible for their own
detector state and entry/exit policy.
