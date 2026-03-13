---
sidebar_position: 1
title: Overview
slug: /
---

TradeJS is a TypeScript-native trading platform for:

- running strategy logic in live mode,
- scanning and sending signals,
- running large backtests,
- training and serving ML models,
- enriching runtime decisions with AI review.

TradeJS public developer surface is:

- `@tradejs/core` - browser-safe authoring API, config helpers, shared indicator/math/time helpers
- `@tradejs/node` - Node runtime for strategy execution, backtests, Pine loading, connector/plugin registries
- `@tradejs/cli` - operational commands for backtests, signals, bots, doctor checks, ML workflows
- `@tradejs/app` - optional installable Next.js UI for viewing backtests, dashboards, and runtime data

## Read Next

- [Quickstart](./getting-started/quickstart)
- [Set up root user](./getting-started/root-user)
- [Core API](./api/framework)
- [CLI API](./api/cli)
- [Create strategies](./strategies/authoring/write-strategies)
- [Write indicators](./indicators/authoring)
