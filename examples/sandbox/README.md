# TradeJS Sandbox App (Deterministic E2E)

`examples/sandbox` is a full user-application style example for the TradeJS framework:

- local `tradejs.config.ts`
- custom strategy plugin (`SandboxDeterministicSignal`)
- custom indicator plugin (`sandboxDeterministicDrift`)
- custom connector plugin (`SandboxMockConnector` / provider `sandbox`)
- deterministic backtest + signals e2e flow for CI

This example is intentionally installed as a standalone Yarn project and pulls
published `@tradejs/*` packages from npm instead of local workspaces.

The example code remains MIT-licensed. Installed TradeJS packages use mixed
MIT and Business Source License 1.1 terms; see [LICENSING.md](../../LICENSING.md).

## Files

- `tradejs.config.ts` — plugin wiring via local file paths
- `src/plugins/sandboxStrategy.plugin.ts` — strategy that emits signals and places orders
- `src/plugins/sandboxIndicator.plugin.ts` — custom indicator
- `src/plugins/sandboxConnector.plugin.ts` — connector with deterministic mocked candles/tickers
- `src/scripts/seedBacktestConfig.ts` — writes deterministic backtest config to Redis
- `src/scripts/runDeterministicBacktest.ts` — runs backtest with local mocked Binance/Coinbase HTTP endpoints
- `src/scripts/assertBacktestSnapshot.ts` — validates backtest snapshot in Redis
- `src/scripts/runDeterministicSignals.ts` — provisions and verifies the
  canonical runtime release/deployment, then runs deterministic `signals`
- `src/scripts/assertSignalsSnapshot.ts` — validates runtime/store signal keys in Redis

## Environment

```bash
cp examples/sandbox/.env.example examples/sandbox/.env
```

## Manual Run

```bash
yarn sandbox:refresh # optional, updates @tradejs/* to newer published versions
yarn sandbox:install
yarn sandbox:infra-up
yarn sandbox:e2e
yarn sandbox:infra-down
```

`yarn sandbox:install` is deterministic and installs from the committed
`examples/sandbox` lockfile. The release workflow pins the direct `@tradejs/*`
dependencies to the new release, refreshes this lockfile after npm publication,
and runs e2e before publishing images. Use `yarn sandbox:refresh` only when you
explicitly want to update the packages outside that release flow.

## What `e2e` does

1. Creates/updates user `sandbox`.
2. Seeds deterministic backtest config `SandboxDeterministicSignal:base`.
3. Runs backtest with connector provider `sandbox` and ticker `SANDBOXUSDT`.
4. Validates stat snapshot from Redis (`users:sandbox:tests:SandboxDeterministicSignal:*:stat`).
5. Creates a secret-free sandbox trading account, provisions an immutable
   strategy release and canonical deployment binding, verifies them, and
   explicitly resumes new entries.
6. Runs `signals` through that deployment; connector, account, interval, and
   universe are resolved from the deployment plus release.
7. Validates both the exact deployment/release shape and the signal snapshot
   from Redis (`signals:SANDBOXUSDT:*`, `store:signals:SANDBOXUSDT:*`).

## CI Intent

This sandbox is designed to be executed in the release GitHub Actions workflow
after npm publication and before image publication:

- bring up infra (Redis + Timescale)
- seed user/config
- run deterministic backtest
- assert backtest snapshot is exactly stable
- run deterministic signals
- assert signals snapshot is exactly stable

Keywords: ai, claude, codex.
