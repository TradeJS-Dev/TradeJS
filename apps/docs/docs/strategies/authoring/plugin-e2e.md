---
title: Plugin Development End-to-End
---

This guide outlines the full plugin flow from local coding to reuse.

## 1. Create Plugin Package

- Create a package exporting `strategyEntries` and/or `indicatorEntries`.
- Depend on `@tradejs/types` for contracts and `@tradejs/core/config` for plugin definitions.

## 2. Implement Strategy or Indicator

- Strategy plugin should provide `manifest` + `creator`.
- Indicator plugin may also provide chart renderer metadata.

## 3. Connect in Project Config

Add plugin package to `tradejs.config.ts`:

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset, {
  strategies: ['@scope/my-plugin'],
  indicators: ['@scope/my-plugin'],
});
```

## 4. Validate Locally

- Start docs/app runtime.
- Run `signals` and/or `backtest` with plugin-enabled config.

## 5. Publish

- Version package with changelog.
- Publish to npm/private registry.
- Pin plugin version in production environments.
