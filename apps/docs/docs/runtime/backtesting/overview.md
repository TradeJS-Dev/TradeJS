---
sidebar_position: 8
title: How Backtests Work
---

## Entry Point

Run:

```bash
npx @tradejs/cli backtest
```

Local infra prerequisite:

```bash
npx @tradejs/cli infra-init
npx @tradejs/cli infra-up
```

`infra-init` creates `docker-compose.dev.yml` once and keeps user changes if file already exists.
`infra-up` starts Redis + PostgreSQL/Timescale using that file.
Stop infra after work with `npx @tradejs/cli infra-down`.

Main files:

- script: `@tradejs/cli`
- worker: `@tradejs/core`

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
npx @tradejs/cli backtest --config trendline --connector bybit --tests 500 --parallel 4 --ml
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
npx @tradejs/cli backtest --ml
```

Workers write chunk files:

- `ml-dataset-<strategy>-<chunkId>.jsonl`

Later, merge with:

```bash
npx @tradejs/cli ml-export
```

## Related Guides

- `runtime/backtesting/grid-config`
- `runtime/backtesting/results-runtime-config`
- [Data sync and continuity](../data/continuity-update-history)
