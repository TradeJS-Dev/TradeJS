---
sidebar_position: 8
title: How Backtests Work
---

## Entry Point

Run:

```bash
yarn backtest
```

Main files:

- script: `packages/cli/src/scripts/backtest.ts`
- worker: `packages/core/src/workers/tester.ts`

## Real CLI Flags (from code)

```ts
args.option(['c', 'config'], 'Backtest config', 'breakout');
args.option(['n', 'tests'], 'Tests limit', TESTS_LIMIT);
args.option(['p', 'parallel'], 'Parallel tasks', MAX_PARALLEL);
args.option('connector', 'Connector/provider', 'bybit');
args.option(['m', 'ml'], 'Write ML dataset rows', false);
```

Example run for TrendLine-like setup:

```bash
yarn backtest --config trendline --connector bybit --tests 500 --parallel 4 --ml
```

## Pipeline

1. Resolve backtest config from Redis (`users:<user>:backtests:configs:<config>`).
1. Load symbols from selected connector.
1. Refresh candle cache (unless `--cacheOnly`).
1. Build test-suite grid.
1. Split suite into chunks and run worker processes.
1. Aggregate stats and store top results.

## Real Worker Processing Pattern

```ts
for await (const test of testSuite) {
  const testResult = await testing(test);
  process.send?.({
    stat: testResult.stat,
    orderLogId: testResult.orderLogId,
    test,
  });
}
```

## ML Dataset During Backtest

Enable ML rows writing:

```bash
yarn backtest --ml
```

Workers write chunk files:

- `ml-dataset-<strategy>-<chunkId>.jsonl`

Later, merge with:

```bash
yarn ml-export
```

## Related Guides

- `runtime/backtest-grid-config`
- `runtime/backtest-results-runtime-config`
- `runtime/data-continuity-update-history`
