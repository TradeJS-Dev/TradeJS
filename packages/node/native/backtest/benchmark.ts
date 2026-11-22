import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpus, platform, arch } from 'node:os';
import { createRequire } from 'node:module';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type {
  Connector,
  KlineChartData,
  KlineChartItem,
  Test,
  TestTradeResult,
} from '@tradejs/types';
import { alignSortedCandlesByTimestamp } from '@tradejs/core/indicators';
import { Pool } from 'pg';
import { createStrategyRuntime } from '../../src/strategyRuntime';
import { createBacktestSession } from '../../src/backtest/session';
import { runBacktestCandleLoop } from '../../src/backtest/candleLoop';
import {
  alignNativeBacktestCandles,
  type NativeBacktestKernel,
} from '../../src/backtest/nativeKernel';
import {
  createHeadAndShouldersEngine,
  type HeadAndShouldersPattern,
  type HeadAndShouldersRuntimeState,
} from 'experiment-detector-ts';
import { createHeadAndShouldersCoreWithDetector } from 'experiment-strategy-core';
import {
  createHeadAndShouldersRustCore,
  createHeadAndShouldersRustDetector,
  packHeadAndShouldersCandles,
  type HeadAndShouldersNativeAddon,
} from 'experiment-detector-rust';
import { HeadAndShouldersStrategyDefinition } from 'experiment-strategy';
import { headAndShouldersRuntime } from 'experiment-project-config';

const [
  frameworkAddonFile,
  strategyAddonFile,
  instrumentsFile,
  output,
  selection,
] = process.argv.slice(2);
const request = createRequire(__filename);
const kernel: NativeBacktestKernel = request(frameworkAddonFile);
const native: HeadAndShouldersNativeAddon = request(strategyAddonFile);
const { config: runtimeConfig } = headAndShouldersRuntime;
const { createCore, defaults, manifest } = HeadAndShouldersStrategyDefinition;
const config = {
  ...defaults,
  ...runtimeConfig,
  ENV: 'BACKTEST',
  AI_ENABLED: false,
  ML_ENABLED: false,
  MAX_LOSS_VALUE: 10,
};
const strategyName = 'HeadAndShoulders';
const tsStrategy = createStrategyRuntime({
  strategyName,
  createCore,
  defaults,
  manifest,
});
const rustStrategy = createStrategyRuntime({
  strategyName,
  createCore: createHeadAndShouldersRustCore(native),
  defaults,
  manifest,
});
const start = Date.parse(
  process.env.EXPERIMENT_START ?? '2025-10-22T00:00:00Z',
);
const end = Date.parse(process.env.EXPERIMENT_END ?? '2026-10-22T00:00:00Z');
const preload = start - 60 * 86_400_000;
const bar = 15 * 60_000;

type MarketInstrument = {
  symbol: string;
  status: string;
  contractType: string;
  quoteCoin: string;
  launchTime: string;
  lotSizeFilter: { qtyStep: string; minOrderQty: string };
  leverageFilter: { maxLeverage: string };
};
const response = JSON.parse(readFileSync(instrumentsFile, 'utf8'));
assert.equal(response.retCode, 0);
assert.equal(response.result.nextPageCursor, '');
const instruments: MarketInstrument[] = response.result.list
  .filter(
    (item: MarketInstrument) =>
      item.status === 'Trading' &&
      item.contractType === 'LinearPerpetual' &&
      item.quoteCoin === 'USDT',
  )
  .sort((a: MarketInstrument, b: MarketInstrument) =>
    a.symbol.localeCompare(b.symbol),
  );

const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE ?? process.env.PG_DB,
  max: 1,
  options: '-c default_transaction_read_only=on',
});

const load = async (
  provider: string,
  symbol: string,
): Promise<KlineChartData> => {
  const result = await pool.query<KlineChartItem>(
    `
    SELECT (extract(epoch from ts)*1000)::float8 as timestamp, open, high, low, close,
           volume, turnover, taker_buy_base_volume as "takerBuyBaseVolume",
           taker_buy_quote_volume as "takerBuyQuoteVolume",
           taker_sell_base_volume as "takerSellBaseVolume",
           taker_sell_quote_volume as "takerSellQuoteVolume"
    FROM candles WHERE provider = $1 AND symbol = $2 AND interval = 15
      AND ts >= $3 AND ts < $4 ORDER BY ts
  `,
    [provider, symbol, new Date(preload), new Date(end)],
  );
  return result.rows.map((candle) => ({
    ...candle,
    dt: new Date(candle.timestamp).toISOString(),
  }));
};

const asOf = async () => {
  const btc = await load('bybit', 'BTCUSDT');
  const eth = await load('bybit', 'ETHUSDT');
  const binance = await load('binance', 'BTCUSDT');
  const coinbase = await load('coinbase', 'BTCUSDT');
  for (const [label, series] of Object.entries({
    btc,
    eth,
  })) {
    assert.equal(series.length, (end - preload) / bar, label);
    assert.ok(
      series.every(
        (candle, index) => candle.timestamp === preload + index * bar,
      ),
      label,
    );
  }
  return { btc, eth, binance, coinbase };
};

const prepare = (
  raw: KlineChartData,
  market: Awaited<ReturnType<typeof asOf>>,
  nativeEngine: boolean,
  validFrom: number,
) => {
  const align = nativeEngine
    ? (left: KlineChartData, right: KlineChartData) =>
        alignNativeBacktestCandles(kernel, left, right)
    : alignSortedCandlesByTimestamp;
  const { alignedCoinCandles: data, alignedBtcCandles: btcData } = align(
    raw,
    market.btc,
  );
  const ethData = align(data, market.eth).alignedBtcCandles;
  const warmup = data.findIndex((candle) => candle.timestamp >= validFrom);
  assert.ok(warmup >= 0);
  return {
    data,
    btcData,
    ethData,
    prevData: data.slice(0, warmup),
    testData: data.slice(warmup),
    btcPrevData: btcData.slice(0, warmup),
    btcTestData: btcData.slice(warmup),
    ethPrevData: ethData.slice(0, warmup),
    ethTestData: ethData.slice(warmup),
    btcBinanceData: align(data, market.binance).alignedBtcCandles,
    btcCoinbaseData: align(data, market.coinbase).alignedBtcCandles,
    backtestExecutionInterval: '15' as const,
    backtestExecutionData: [],
    backtestExecutionBtcData: [],
    backtestExecutionDataByTimestamp: new Map(),
    backtestExecutionBtcDataByTimestamp: new Map(),
  };
};

type MeasuredTrade = Omit<TestTradeResult, 'signalId' | 'positionCycleId'>;
type Variant = 'ts' | 'rust-strategy' | 'rust-both' | 'ts-batch' | 'rust-batch';

const createBatchStrategy = (
  raw: KlineChartData,
  firstTestIndex: number,
  useRust: boolean,
) => {
  const candleIndexes = new Map(
    raw.map(({ timestamp }, index) => [timestamp, index]),
  );
  const patterns = new Map<number, HeadAndShouldersPattern>();
  const runDetector = (config: typeof defaults, through: number) => {
    if (useRust) {
      const detector = createHeadAndShouldersRustDetector(native, config);
      const results: Array<[number, HeadAndShouldersPattern]> = JSON.parse(
        detector.scan(packHeadAndShouldersCandles(raw.slice(0, through))),
      );
      return {
        results,
        snapshot: () =>
          JSON.parse(detector.snapshot()) as HeadAndShouldersRuntimeState,
      };
    }
    const detector = createHeadAndShouldersEngine({ config });
    const results: Array<[number, HeadAndShouldersPattern]> = [];
    for (let index = 0; index < through; index++) {
      const pattern = detector.nextPattern(raw[index]);
      if (pattern) results.push([index, pattern]);
    }
    return { results, snapshot: detector.getState };
  };
  const createCore = createHeadAndShouldersCoreWithDetector(
    ({ config, initialCandles = [] }) => {
      assert.equal(initialCandles.length, firstTestIndex);
      for (const [index, pattern] of runDetector(config, raw.length).results)
        patterns.set(index, pattern);
      let cursor = firstTestIndex - 1;
      return {
        next: (candle) => {
          const index = candleIndexes.get(candle.timestamp);
          assert.ok(
            index !== undefined && index >= cursor,
            'Unexpected candle in batched replay',
          );
          cursor = index;
          return { pattern: patterns.get(index) ?? null };
        },
        getState: () => runDetector(config, cursor + 1).snapshot(),
      };
    },
  );
  return {
    strategy: createStrategyRuntime({
      strategyName,
      createCore,
      defaults,
      manifest,
      detectorKey: () => 'frozen-backtest-candles',
      detectorNoSignalSkipReason: 'NO_PATTERN',
    }),
    predictNoSignal: (index: number) => !patterns.has(index + firstTestIndex),
  };
};
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const run = async (
  item: MarketInstrument,
  raw: KlineChartData,
  market: Awaited<ReturnType<typeof asOf>>,
  variant: Variant,
  validFrom: number,
) => {
  const { symbol } = item;
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  const data = prepare(raw, market, variant === 'rust-both', validFrom);
  const t1 = performance.now();
  const test: Test = {
    testId: 'rust-comparison',
    testSuiteId: 'rust-comparison',
    name: 'rust-comparison',
    userName: 'root',
    connectorName: 'bybit',
    interval: '15',
    strategyName,
    symbol,
    strategyConfig: config,
    instrument: {
      provider: 'bybit',
      symbol,
      universe: 'crypto',
      assetClass: 'crypto',
      venueMetadata: {
        ...item.lotSizeFilter,
        maxLeverage: item.leverageFilter.maxLeverage,
      },
    },
    executionCostsCacheOnly: true,
    options: { start: validFrom, end },
    fast: false,
  };
  const trades: MeasuredTrade[] = [];
  const actions = {
    run: <T>(_stage: string, call: () => Promise<T>) => call(),
    runStrategy: <T>(_stage: string, call: () => Promise<T>) => call(),
    checkpoint: () => {},
    setCandle: () => {},
    contextStage: () => {},
  };
  const connector: Pick<Connector, 'universe' | 'kline'> = {
    universe: 'crypto',
    kline: async () => {
      throw new Error(
        'Unexpected kline request: comparison uses prepared market data',
      );
    },
  };
  const batch =
    variant === 'ts-batch' || variant === 'rust-batch'
      ? createBatchStrategy(
          data.data,
          data.prevData.length,
          variant === 'rust-batch',
        )
      : undefined;
  const session = await createBacktestSession({
    test,
    connector: connector as Connector,
    preparedData: data,
    interval: '15',
    monitor: actions,
    strategyCreator:
      batch?.strategy ?? (variant === 'ts' ? tsStrategy : rustStrategy),
    nativeKernel: variant === 'rust-both' ? kernel : undefined,
    onClosedTrade: ({
      signalId: _signalId,
      positionCycleId: _cycle,
      ...trade
    }) => trades.push(trade),
  });
  const t2 = performance.now();
  await runBacktestCandleLoop(data, session, actions, batch?.predictNoSignal);
  const result = await session.result();
  const t3 = performance.now();
  const cpu = process.cpuUsage(cpu0);
  const orders = result.inlineOrderLog?.map(
    ({ type, timestamp, price, qty, profit, fee, amount }) => ({
      type,
      timestamp,
      price,
      qty,
      profit,
      fee,
      amount,
    }),
  );
  return {
    comparison: {
      trades,
      stat: result.stat,
      orders,
      positions: result.inlinePositionLog,
    },
    time: {
      variant,
      totalMs: t3 - t0,
      prepMs: t1 - t0,
      initMs: t2 - t1,
      loopMs: t3 - t2,
      cpuMs: (cpu.user + cpu.system) / 1000,
    },
  };
};

const scan = (raw: KlineChartData) => {
  const packed = packHeadAndShouldersCandles(raw);
  const ts = createHeadAndShouldersEngine({ config });
  const rustDetector = createHeadAndShouldersRustDetector(native, config);
  let t = performance.now();
  const patterns = raw.flatMap((candle, index) => {
    const { pattern } = ts.next(candle);
    return pattern ? [[index, pattern]] : [];
  });
  const tsMs = performance.now() - t;
  t = performance.now();
  const rustPatterns = JSON.parse(rustDetector.scan(packed));
  const rustMs = performance.now() - t;
  assert.deepEqual(rustPatterns, patterns);
  assert.deepEqual(JSON.parse(rustDetector.snapshot()), ts.getState());
  t = performance.now();
  packHeadAndShouldersCandles(raw);
  const packMs = performance.now() - t;
  return { tsMs, rustMs, packMs, patterns: patterns.length };
};

const main = async () => {
  const market = await asOf();
  const selected = selection
    ? selection.split(',')
    : instruments.map(({ symbol }) => symbol);
  const lookup = new Map(instruments.map((item) => [item.symbol, item]));
  const warmup = lookup.get('BTCUSDT');
  assert.ok(warmup);
  const measuredVariants: Variant[] =
    process.env.EXPERIMENT_BATCH === '1'
      ? ['ts', 'ts-batch', 'rust-batch']
      : ['ts', 'rust-strategy', 'rust-both'];
  for (const variant of measuredVariants)
    await run(warmup, market.btc, market, variant, start);
  scan(market.btc);
  const runStart = performance.now();
  let completed = 0;
  writeFileSync(
    `${output}.manifest.json`,
    JSON.stringify(
      {
        start,
        end,
        variants: measuredVariants,
        preload,
        config,
        instrumentsFile,
        instruments: selected,
        universeSnapshotTime: response.time,
        universeSnapshotSha256: hash(response),
        references: Object.fromEntries(
          Object.entries(market).map(([key, rows]) => [
            key,
            { count: rows.length, sha256: hash(rows) },
          ]),
        ),
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        node: process.version,
        frameworkAddonSha256: createHash('sha256')
          .update(readFileSync(frameworkAddonFile))
          .digest('hex'),
        strategyAddonSha256: createHash('sha256')
          .update(readFileSync(strategyAddonFile))
          .digest('hex'),
      },
      null,
      2,
    ),
  );
  writeFileSync(output, '');
  for (const [index, symbol] of selected.entries()) {
    const item = lookup.get(symbol);
    assert.ok(item, `Instrument missing: ${symbol}`);
    const launched = Number(item.launchTime);
    const t = performance.now();
    const raw = await load('bybit', symbol);
    const dbMs = performance.now() - t;
    const listingBar = Math.floor(launched / bar) * bar;
    const expectedStart = Math.max(
      preload,
      raw[0]?.timestamp === listingBar
        ? listingBar
        : Math.ceil(launched / bar) * bar,
    );
    const expected = (end - expectedStart) / bar;
    const applicable =
      expectedStart < start || end - expectedStart > 60 * 86_400_000;
    if (
      raw.length !== expected ||
      !applicable ||
      !raw.every((candle, i) => candle.timestamp === expectedStart + i * bar)
    ) {
      appendFileSync(
        output,
        JSON.stringify({
          symbol,
          status: applicable ? 'incomplete-cache' : 'insufficient-warmup',
          bars: raw.length,
          expected,
          expectedStart,
          first: raw[0]?.timestamp,
          last: raw.at(-1)?.timestamp,
          dbMs,
        }) + '\n',
      );
      continue;
    }
    const validFrom = Math.max(start, expectedStart + 60 * 86_400_000);
    // Use available candles for warmup on newer instruments. Start trading
    // after the exact same 60-day warmup in all variants.
    const warmRaw = raw.filter(
      (candle) => candle.timestamp >= validFrom - 60 * 86_400_000,
    );
    const variants = measuredVariants.map(
      (_, offset) =>
        measuredVariants[(completed + offset) % measuredVariants.length],
    );
    const measurements = [];
    for (const variant of variants) {
      measurements.push(await run(item, warmRaw, market, variant, validFrom));
    }
    const [reference, ...candidates] = measurements;
    for (const candidate of candidates)
      assert.deepEqual(candidate.comparison, reference.comparison, symbol);
    const detector = scan(warmRaw);
    appendFileSync(
      output,
      JSON.stringify({
        symbol,
        status: 'completed',
        bars: warmRaw.length,
        validFrom,
        inputSha256: hash(warmRaw),
        comparisonSha256: hash(reference.comparison),
        trades: reference.comparison.trades,
        dbMs,
        times: measurements.map(({ time }) => time),
        detector,
      }) + '\n',
    );
    completed += 1;
    if (completed % 10 === 0 || completed === 1)
      console.log(
        index + 1,
        '/',
        selected.length,
        symbol,
        detector.patterns,
        reference.comparison.trades.length,
      );
  }
  writeFileSync(
    `${output}.receipt.json`,
    JSON.stringify(
      {
        selected: selected.length,
        completed,
        elapsedMs: performance.now() - runStart,
        peakRssKiB: process.resourceUsage().maxRSS,
      },
      null,
      2,
    ),
  );
};

main()
  .finally(() => pool.end())
  .then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
