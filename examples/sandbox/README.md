# TradeJS Sandbox App (Deterministic E2E)

`examples/sandbox` is a full user-application style example for the TradeJS open-source framework:

- local `tradejs.config.ts`
- custom strategy plugin (`SandboxDeterministicSignal`)
- custom indicator plugin (`sandboxDeterministicDrift`)
- custom connector plugin (`SandboxMockConnector` / provider `sandbox`)
- deterministic backtest + signals e2e flow for CI

This example is intentionally installed as a standalone Yarn project and pulls
published `@tradejs/*` packages from npm instead of local workspaces.

## Files

- `tradejs.config.ts` — plugin wiring via local file paths
- `src/plugins/sandboxStrategy.plugin.ts` — strategy that emits signals and places orders
- `src/plugins/sandboxIndicator.plugin.ts` — custom indicator
- `src/plugins/sandboxConnector.plugin.ts` — connector with deterministic mocked candles/tickers
- `src/scripts/seedBacktestConfig.ts` — writes deterministic backtest config to Redis
- `src/scripts/runDeterministicBacktest.ts` — runs backtest with local mocked Binance/Coinbase HTTP endpoints
- `src/scripts/assertBacktestSnapshot.ts` — validates backtest snapshot in Redis
- `src/scripts/runDeterministicSignals.ts` — runs deterministic `signals` flow with connector `sandbox`
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
`examples/sandbox` lockfile. Use `yarn sandbox:refresh` only when you explicitly
want to update the published `@tradejs/*` versions used by the sandbox.

## What `e2e` does

1. Creates/updates user `sandbox`.
2. Seeds deterministic backtest config `SandboxDeterministicSignal:base`.
3. Runs backtest with connector provider `sandbox` and ticker `SANDBOXUSDT`.
4. Validates stat snapshot from Redis (`users:sandbox:tests:SandboxDeterministicSignal:*:stat`).
5. Runs `signals` with connector provider `sandbox`.
6. Validates signal snapshot from Redis (`signals:SANDBOXUSDT:*`, `store:signals:SANDBOXUSDT:*`).

## CI Intent

This sandbox is designed to be executed in GitHub Actions before deploy:

- bring up infra (Redis + Timescale)
- seed user/config
- run deterministic backtest
- assert backtest snapshot is exactly stable
- run deterministic signals
- assert signals snapshot is exactly stable
