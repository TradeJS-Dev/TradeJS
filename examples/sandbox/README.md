# TradeJS Sandbox App (Deterministic E2E)

`examples/sandbox` is a full user-application style example:

- local `tradejs.config.ts`
- custom strategy plugin (`SandboxDeterministicSignal`)
- custom indicator plugin (`sandboxDeterministicDrift`)
- custom connector plugin (`SandboxMockConnector` / provider `sandbox`)
- deterministic backtest e2e flow for CI

## Files

- `tradejs.config.ts` — plugin wiring via local file paths
- `src/plugins/sandboxStrategy.plugin.ts` — strategy that emits signals and places orders
- `src/plugins/sandboxIndicator.plugin.ts` — custom indicator
- `src/plugins/sandboxConnector.plugin.ts` — connector with deterministic mocked candles/tickers
- `src/scripts/seedBacktestConfig.ts` — writes deterministic backtest config to Redis
- `src/scripts/runDeterministicBacktest.ts` — runs backtest with local mocked Binance/Coinbase HTTP endpoints
- `src/scripts/assertBacktestSnapshot.ts` — validates backtest snapshot in Redis

## Environment

```bash
cp examples/sandbox/.env.example examples/sandbox/.env
```

## Manual Run

```bash
cd examples/sandbox
yarn infra-up
yarn e2e
yarn infra-down
```

## What `e2e` does

1. Creates/updates user `sandbox`.
2. Seeds deterministic backtest config `SandboxDeterministicSignal:base`.
3. Runs backtest with connector provider `sandbox` and ticker `SANDBOXUSDT`.
4. Validates stat snapshot from Redis (`users:sandbox:tests:SandboxDeterministicSignal:*:stat`).

## CI Intent

This sandbox is designed to be executed in GitHub Actions before deploy:

- bring up infra (Redis + Timescale)
- seed user/config
- run deterministic backtest
- assert snapshot is exactly stable
