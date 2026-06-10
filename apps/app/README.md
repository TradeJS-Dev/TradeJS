# @tradejs/app

Publishable Next.js UI package for the TradeJS open-source framework, with backtests, charts, and signal flows.

Typical external usage:

```bash
npm install @tradejs/app @tradejs/core @tradejs/node @tradejs/types @tradejs/base @tradejs/cli
npx tradejs-app dev
```

Use matching versions for all `@tradejs/*` packages. The installable launcher
requires `@tradejs/app@1.0.10` or newer.

The launcher reads env and `tradejs.config.ts` from the caller project directory
via `PROJECT_CWD`. When it runs from `node_modules`, it creates a generated
`.tradejs/app` working copy and runs Next.js there.
