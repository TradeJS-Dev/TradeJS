# Research visuals: internal workflow

`research-visuals` turns saved trade evidence into a repeatable atlas and
completed-trade drawdown report. Run from `tradejs-project`. It reads local files
only: no history refresh, strategy execution, gate recomputation or live orders.

```bash
yarn exec tradejs research-visuals --input data/research/example/trades.json \
  --outDir output/example-visuals --count 100 --png
```

For an unreleased framework checkout, build `@tradejs/cli` there and invoke its
`dist/cli.js` with Node 24 from the Project working directory. The installed
Project CLI does not automatically contain unshipped source changes.

## Input contract

Use `tradejs-research-visuals/v1` JSON (optionally `.gz`):

```json
{
  "schema": "tradejs-research-visuals/v1",
  "source": "immutable candidate and run identifier",
  "population": "complete",
  "intervalMs": 300000,
  "trades": [
    {
      "id": "unique-trade-id",
      "strategy": "Example",
      "symbol": "BTCUSDT",
      "direction": "LONG",
      "signalTime": 1800000000000,
      "entryTime": 1800000300000,
      "exitTime": 1800000600000,
      "entryPrice": 100,
      "exitPrice": 98,
      "pnl": -2.1,
      "stop": 98,
      "target": 104,
      "pockets": { "candidate-a": true },
      "features": { "signalAtrPercent": 1.2 },
      "groups": { "volatility": "high", "money": "medium" },
      "candles": [],
      "figures": { "lines": [], "points": [], "zones": [] }
    }
  ]
}
```

Timestamps are UTC epoch milliseconds. `pnl` is realized **net** PnL in USDT,
including costs. Supply completed trades from one reconciled execution scope;
`complete` is the caller's declaration, not an automatic reconciliation check.
Do not merge alternative candidates, duplicated fills, overlapping exports, or
independent symbol simulations and call them a portfolio. Use `selected` for
partial history, balanced cases or any preselected subset. Only USDT contracts
are accepted. Use one candle interval per report.

Candles contain `timestamp, open, high, low, close, volume`. Optional saved
`smaFast, smaSlow, bbUpper, bbLower` values are rendered when supplied. Instead
of repeating candles per trade, use `candlesBySymbol` in the document or
`--candles candles.json` with a symbol-to-candles map. Missing candles are
reported; the tool never fetches them. Figures use `{points:[{timestamp,value}]}`
for lines/point groups and `{start:{timestamp,value},end:{timestamp,value}}`
for zones.

Native completed AI export rows are also accepted as JSON arrays or JSONL
(optionally gzip). Repeat `--input` for disjoint shards of the **same** run.
Supply `--population complete|selected` and `--intervalMs`. Native rows use
`tradeResult`, `payload.signal`, `payload.figures`, `payload.featureSnapshot`.
Only registered snapshot features with `role: input` enter feature comparisons.
Explicit `features` must contain signal-time measurements; never add outcomes,
post-entry extrema, future group assignments or current gate answers. Explicit
pocket labels and native `approved` are diagnostic overlays, not AI inputs.
Unfinished rows, duplicate trade IDs and mixed backtest run IDs are rejected.

The recent `trade-atlas-chart-points/v1` archives can be read directly; pass
`--strategy` when the archive does not name it. Their population is always
`selected`, even if `--population complete` is requested. The same protection
applies to the new retained `chart-inputs.json.gz` files. This adapter supports
re-rendering existing evidence; do not rerun retired studies to fill gaps.

## What the report means

- Default atlas: up to 100 wins and 100 losses **per strategy**, selected from
  equal chronological strata using a stable SHA-256 choice and `--seed`.
  Sparse populations use all available cases without duplication. Zero-PnL
  trades remain in aggregate analysis but not the balanced atlas.
- Each SVG (and optional PNG) shows candles, volume, signal/entry/exit, saved
  geometry, stop/target, indicators and an entry zoom. Absent saved indicators
  use analytical SMA14/50 and Bollinger20 ±2 standard deviations. These are
  labelled analytical and do not reconstruct a strategy's native indicators.
- Pockets show pass/fail/unknown separately. Numeric feature contrasts show
  win/loss medians, support, missingness and difference relative to IQR.
  They use all supplied rows, **not** the balanced atlas. A selected input
  remains biased and is labelled accordingly. These are descriptive leads
  for hypotheses, not significance tests or evidence of future profitability.
- Drawdowns require `complete`: cumulative realized net PnL, same-time exits
  netted, peak-to-recovery episodes and the final unrecovered episode. Reports
  separate ALL/LONG/SHORT. These are not intratrade mark-to-market drawdowns.
  Contributions by symbol, strategy, direction and supplied ticker groups
  include recovery trades; dimensions overlap and must not be summed together.
- MFE/MAE uses fully held bars only and requires complete coverage from entry
  to exit. Otherwise it is unavailable. Exit-bar extremes and partial-bar
  guesses do not become signal-time features.

The HTML gallery filters by strategy, direction, outcome and admitted pocket.
`analysis.json` retains support and group contributions. `manifest.json` records
input SHA-256, selection parameters, completion state and output checksums.
A fresh output directory is mandatory; existing evidence is never overwritten.

## Retention and extension

Keep compact analysis, charts, manifest and `chart-inputs.json.gz` with the
study's permanent evidence. The latter retains selected trades and bounded
chart candle windows (including indicator warmup), not the full temporary
export. Keep the original source/candidate/config lineage under the existing
research retention rules. The renderer does not delete inputs or retire studies.

Reusable code belongs in `packages/cli/src/lib/researchVisuals/`: input
normalization, deterministic analysis and SVG rendering. The facade owns file
loading and report generation; `src/scripts/researchVisuals.ts` only parses CLI
arguments. Strategy-specific pocket reconstruction and hypothesis logic stay
with their owning strategy/research workflow. Reuse the existing final
composition board for candidate comparisons rather than cloning it here.

Shared candle histories are validated and normalized once per symbol. Trades
reference that normalized array; rendering and retained inputs use bounded
windows found by binary search, including indicator warmup. Supplying inline
candles still means a separate per-trade series. Input file/decompression size
limits remain enforced; this optimization does not make unbounded input safe.
