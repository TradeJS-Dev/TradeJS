# TradeJS Sandbox Plugin

Пример пользовательского strategy plugin для TradeJS.

## Что внутри

- Стратегия: `SandboxMomentum`
- Экспорт: `strategyEntries` (контракт plugin API из `@tradejs/core`)
- Индикатор: `sandboxMomentum` + `renderer` для auto-registration в chart

## Как запустить

`tradejs.config.ts` в корне уже содержит:

```ts
import { defineConfig } from '@tradejs/core';

export default defineConfig({
  strategyPlugins: ['@tradejs/example-sandbox'],
  indicatorsPlugins: ['@tradejs/example-sandbox'],
});
```

После этого:

```bash
yarn dev
```

## Минимальные параметры стратегии

- `SANDBOX_MIN_MOVE_PCT` (default: `0.35`)
- `SANDBOX_TP_PCT` (default: `0.6`)
- `SANDBOX_SL_PCT` (default: `0.3`)
