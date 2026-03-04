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

## Knowledge Base Map

- Start and installation: `getting-started/*`
- Core APIs: `api/framework`, `api/cli`
- Strategy development: `strategies/*`
- Indicator development: `indicators/*`
- Runtime and backtesting: `runtime/*`
- ML and AI policy: `ai-ml/ml/*`, `ai-ml/ai/*`
- Production operations: `operations/*`

## Read Next

- [Start locally](./getting-started/local)
- [Set up root user](./getting-started/root-user)
- [Self-hosted deployment](./getting-started/self-hosted)
- [Cloud usage](./getting-started/cloud)
- [Framework API](./api/framework)
- [CLI API](./api/cli)
- [Create strategies](./strategies/authoring/write-strategies)
- [Write indicators](./indicators/authoring)
