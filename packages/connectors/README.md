# @tradejs/connectors

Get market data for TradeJS charts and backtests. Connect a Bybit account
to read positions and send orders from your TradeJS runtime.

[Browse the exchange adapters in the TradeJS Marketplace](https://tradejs.dev/marketplace#adapters).

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## License

This package remains MIT-licensed. Some TradeJS runtime dependencies use the
Business Source License 1.1; see the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

## What It Provides

| Adapter                                                    | What it provides                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [Bybit](https://tradejs.dev/marketplace/bybit)             | Market data for USDT perpetuals. Can read positions and send orders for a connected account. |
| [Binance](https://tradejs.dev/marketplace/binance)         | Market data for historical tests and reference prices.                                       |
| [Coinbase](https://tradejs.dev/marketplace/coinbase)       | Spot market data for historical tests and reference prices.                                  |
| [Hyperliquid](https://tradejs.dev/marketplace/hyperliquid) | Public market data for perpetual contracts.                                                  |

## Install

```bash
npm i @tradejs/connectors @tradejs/core
```

## Usage

Most projects should not add this package manually. It is already included by `@tradejs/base`.

If you want to reference it explicitly:

```ts
import { defineConfig } from '@tradejs/core/config';

export default defineConfig({
  connectors: ['@tradejs/connectors'],
});
```

## For Custom Connectors

Use `defineConnectorPlugin(...)` from `@tradejs/core/config` in your own package and add that package to `connectors` in `tradejs.config.ts`.

Keywords: ai, claude, codex.
