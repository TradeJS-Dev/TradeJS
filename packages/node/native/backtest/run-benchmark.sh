#!/usr/bin/env bash
set -euo pipefail

# Run from the TradeJS Project. The worktrees supply the sources and addons.
framework="$(cd "$(dirname "$0")/../../../.." && pwd)"
strategy="$(cd "${1:?Path to HeadAndShoulders worktree}" && pwd)"
instruments="${2:?Path to the captured Bybit instruments-info JSON}"
output="${3:?Path for result JSONL}"
selection="${4:-}"
project="$(pwd)"
detector="$strategy/src/HeadAndShoulders"
addon="$framework/packages/node/native/backtest"
config="$project/config/runtime/strategies/head-and-shoulders.ts"

case "$(uname -s)" in
  Darwin) library_extension=dylib ;;
  Linux) library_extension=so ;;
  *) echo 'Expected macOS or Linux' >&2; exit 1 ;;
esac
for owner in "$addon" "$strategy/native"; do
  cargo build --locked --release --manifest-path "$owner/Cargo.toml"
done
cp "$addon/target/release/libtradejs_backtest_native.$library_extension" "$addon/backtest.node"
cp "$strategy/native/target/release/libtradejs_head_and_shoulders_native.$library_extension" "$strategy/native/detector.node"

bundle="${output%.jsonl}.cjs"
"$framework/node_modules/.bin/esbuild" "$addon/benchmark.ts" \
  --bundle --platform=node --format=cjs --packages=external \
  --alias:experiment-detector-ts="$detector/engine.ts" \
  --alias:experiment-detector-rust="$detector/rust.ts" \
  --alias:experiment-strategy="$detector/strategy.ts" \
  --alias:experiment-strategy-core="$detector/core.ts" \
  --alias:experiment-project-config="$config" \
  --outfile="$bundle"
node --env-file=.env "$bundle" "$addon/backtest.node" "$strategy/native/detector.node" "$instruments" "$output" "$selection"
