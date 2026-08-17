# @tradejs/cli

Official CLI for the TradeJS TypeScript framework.

- Homepage: https://tradejs.dev
- Documentation: https://docs.tradejs.dev
- CLI API docs: https://docs.tradejs.dev/api/cli
- Quickstart: https://docs.tradejs.dev/getting-started/quickstart

## License

Version 2.0.0 and later is licensed under Business Source License 1.1. The
Additional Use Grant permits internal and other non-competing production use;
providing a competing product or service requires a commercial license.
Earlier releases remain MIT-licensed. See the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

## Where It Fits

`@tradejs/cli` is the operational entrypoint for the standard external TradeJS project flow:

- initialize local infra files
- start/stop Redis + PostgreSQL/Timescale
- verify runtime dependencies
- create users
- run backtests, signals, bots, and AI/ML workflows

## Standard External Install Flow

For a new external project with CLI + runtime + UI:

```bash
npx create-tradejs
```

The generator installs the packages, starts local infra, and opens the install
page. The user chooses the local `root` password before entering the dashboard.

For manual integration into an existing project:

```bash
npm i @tradejs/app @tradejs/core @tradejs/node @tradejs/types @tradejs/base @tradejs/cli
```

Add `tradejs.config.ts` in project root:

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset);
```

## Manual Setup Commands

```bash
npx @tradejs/cli infra-init
npx @tradejs/cli infra-up
npx @tradejs/cli doctor
npx @tradejs/cli user-add -u root -p 'StrongPassword123!'
```

After saving a backtest config, you can run:

```bash
npx @tradejs/cli backtest --config MaStrategy:base
npx @tradejs/cli backtest --ai
npx @tradejs/cli ai-export
npx @tradejs/cli ai-train -n 50 --minQuality 4
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

Keywords: ai, claude, codex.
