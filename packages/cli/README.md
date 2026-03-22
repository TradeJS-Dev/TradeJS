# @tradejs/cli

Official CLI for the TradeJS open-source framework.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- CLI API docs: https://docs.tradejs.dev/api/cli
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## Where It Fits

`@tradejs/cli` is the operational entrypoint for the standard external TradeJS project flow:

- initialize local infra files
- start/stop Redis + PostgreSQL/Timescale
- verify runtime dependencies
- create users
- run backtests, signals, bots, and ML workflows

## Standard External Install Flow

For a normal external project with CLI + runtime + UI:

```bash
npm i @tradejs/app @tradejs/core @tradejs/node @tradejs/types @tradejs/base @tradejs/cli
```

Add `tradejs.config.ts` in project root:

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset);
```

## First Commands In A Fresh Project

```bash
npx @tradejs/cli infra-init
npx @tradejs/cli infra-up
npx @tradejs/cli doctor
npx @tradejs/cli user-add -u root -p 'StrongPassword123!'
```

After that you can run:

```bash
npx @tradejs/cli backtest
npx @tradejs/cli signals
npx @tradejs/cli results
npx @tradejs/cli bot
```

And start the UI separately:

```bash
npx tradejs-app dev
```

## Notes

- `@tradejs/cli` expects project wiring from `tradejs.config.ts` via `@tradejs/core/config`.
- Local infrastructure is created through `infra-init` and started through `infra-up`.
- Use `npx @tradejs/cli <command> --help` for command-specific flags.
