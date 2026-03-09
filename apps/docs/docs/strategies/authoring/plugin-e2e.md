---
title: Plugin Development End-to-End
---

This guide outlines the full plugin flow from local coding to reuse.

## 1. Create Plugin Package

- Create a package exporting `strategyEntries` and/or `indicatorEntries`.
- Depend on `@tradejs/core` types.

## 2. Implement Strategy or Indicator

- Strategy plugin should provide `manifest` + `creator`.
- Indicator plugin may also provide chart renderer metadata.

## 3. Connect in Project Config

Add plugin package to `tradejs.config.ts`:

```ts
export default defineConfig({
  strategyPlugins: ['@scope/my-plugin'],
  indicatorsPlugins: ['@scope/my-plugin'],
});
```

## 4. Validate Locally

- Start docs/app runtime.
- Run `signals` and/or `backtest` with plugin-enabled config.

## 5. Publish

- Version package with changelog.
- Publish to npm/private registry.
- Pin plugin version in production environments.
