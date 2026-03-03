---
sidebar_position: 1
title: TradeJS Documentation
slug: /
---

TradeJS is a TypeScript-native trading framework for:

- running strategy logic in live mode,
- scanning and sending signals,
- running large backtests,
- training and serving ML models,
- enriching runtime decisions with AI review.

This documentation is focused on practical usage of the monorepo:

- `apps/app` - Next.js UI + API,
- `packages/core` - strategy runtime, types, helpers,
- `packages/connectors` - exchange connectors and market data,
- `packages/cli` - operational scripts,
- `packages/framework` - public framework API,
- `packages/ml` - Python train/infer services.

## Read Next

- [Start locally](./getting-started/local)
- [Set up root user](./getting-started/root-user)
- [Self-hosted deployment](./getting-started/self-hosted)
- [Cloud usage](./getting-started/cloud)
- [Framework API](./framework/api)
- [CLI API](./cli/api)
- [Write strategies](./strategies/write-strategies)
- [Write indicators](./indicators/write-indicators)
