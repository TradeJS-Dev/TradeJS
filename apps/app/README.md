# @tradejs/app

Publishable Next.js UI package for the TradeJS TypeScript framework, with backtests, charts, and signal flows.

## License

Version 2.0.0 and later is licensed under Business Source License 1.1. The
Additional Use Grant permits internal and other non-competing production use;
providing a competing product or service requires a commercial license.
Earlier releases remain MIT-licensed. See the
[TradeJS licensing policy](https://github.com/TradeJS-Dev/TradeJS/blob/stable/LICENSING.md).

Recommended external usage:

```bash
npx create-tradejs
```

The generator starts local infrastructure and opens the install page. Choose
the local `root` password there; TradeJS then opens the dashboard with a
**Create backtest** action. For manual installation into an existing project:

```bash
npm install @tradejs/app @tradejs/core @tradejs/node @tradejs/types @tradejs/base @tradejs/cli
npx tradejs-app dev
```

Use matching versions for all `@tradejs/*` packages. The installable launcher
is included in current `@tradejs/app` releases.

The launcher reads env and `tradejs.config.ts` from the caller project directory
via `PROJECT_CWD`. When it runs from `node_modules`, it creates a generated
`.tradejs/app` working copy and runs Next.js there.

## Anonymous Onboarding Telemetry

The Web UI reports only the anonymous Yandex Metrica goal names
`scaffold_success` and `first_backtest`. It does not include strategy
configuration, symbols, credentials, or backtest results. Disable these events
before starting or building the app with:

```bash
NEXT_PUBLIC_TRADEJS_TELEMETRY_DISABLED=1
```

Keywords: ai, claude, codex.
