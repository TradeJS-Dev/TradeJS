# @tradejs/types

MIT-licensed shared contracts and TypeScript types for the TradeJS framework.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Core API docs: https://docs.tradejs.dev/api/framework

## License

This package remains MIT-licensed. Some TradeJS runtime dependencies use the
Business Source License 1.1; see the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

## Install

```bash
npm i @tradejs/types
```

## What It Provides

`@tradejs/types` contains shared contracts used across the TradeJS ecosystem:

- strategy/runtime decision types
- plugin entry contracts
- connector contracts
- signal/order/backtest types
- AI/ML adapter types

## Usage

```ts
import type {
  CreateStrategyCore,
  StrategyConfig,
  Signal,
  Connector,
} from '@tradejs/types';
```

Use this package for type imports shared between `@tradejs/core`, `@tradejs/node`, plugins, and external applications.
