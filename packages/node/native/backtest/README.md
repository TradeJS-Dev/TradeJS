# Rust backtest experiment

The addon ports timestamp alignment, OHLC stop and target matching, and fee
and net PnL calculations to Rust. The Node backtester still owns the candle
loop, StrategyAPI, position and order lifecycle, slippage, and funding.
Without an addon path, normal backtests use TypeScript for these calculations.

Build from the framework worktree on macOS with Rust and Node 24 installed.

```bash
cargo build --locked --release --manifest-path packages/node/native/backtest/Cargo.toml
cp packages/node/native/backtest/target/release/libtradejs_backtest_native.dylib packages/node/native/backtest/backtest.node
node packages/node/native/backtest/smoke.mjs packages/node/native/backtest/backtest.node
```

To use the addon from a CLI built in this worktree, set
`TRADEJS_BACKTEST_NATIVE_KERNEL` to the absolute path of `backtest.node`.
The strategy worktree exposes `createHeadAndShouldersRustStrategy(addon)`.
A Node strategy plugin can register the returned `HeadAndShouldersRust`
definition in `strategyEntries` alongside the default definition.

Run the comparison from TradeJS Project. The fourth argument is an optional
comma-separated list of Bybit symbols. Omit it to check every active USDT
perpetual contract in the instruments snapshot. The runner uses cached
15-minute candles with a 60-day warmup and rejects incomplete symbol history.
The benchmark reads Timescale directly and runs the shared backtest session
and candle loop in one Node process. It times preparation and simulation
separately from database reads.

```bash
mkdir -p output/rust-backtest
bash <framework-worktree>/packages/node/native/backtest/run-benchmark.sh \
  <strategy-worktree> output/rust-backtest/bybit-instruments.json \
  output/rust-backtest/year.jsonl
```

The input must be a complete Bybit `instruments-info` response for active
linear contracts. If the endpoint paginates, merge all pages into one response
and clear the final cursor. The runner compares the unmodified TypeScript
path, the streaming Rust detector, and the streaming detector plus the
Rust backtest calculations. Use `EXPERIMENT_BATCH=1` to measure the TypeScript
and Rust detectors with the same batch scheduling and TypeScript simulator.
Batch scheduling reuses the backtest no-signal path after a causal detector
scan of the frozen input. All compared variants must produce identical
normalized orders, positions, and completed trades.

Set `EXPERIMENT_INDICATORS=1` to compare the original rolling BTC correlation
calculation, its optimized TypeScript implementation, and the Rust batch
implementation. All three variants use the same TypeScript detector in batch
mode. The Rust addon computes the causal 50-candle series from paired closes
once per symbol, then the backtester reads each value at its candle timestamp.
The TypeScript indicator controller still computes the other indicators.
The benchmark reports preparation time, native values consumed, and fallback
reads. The optional reference summary in `summarize-benchmark.mjs` verifies
the input and normalized trade hashes against an earlier experiment.
