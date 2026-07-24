import 'dotenv/config';
import args from 'args';
import chalk from 'chalk';
import { connectors, ConnectorNames } from '@tradejs/connectors';
import { getBinanceBreadthUniverses } from '@tradejs/node/strategies';
import {
  upsertMarketBreadthRows,
  upsertMarketTradeFlowRows,
  waitForDbReady,
} from '@tradejs/infra/timescale';
import type {
  AggTrade,
  KlineChartData,
  MarketFeatureInterval,
} from '@tradejs/types';
import {
  aggregateAggTradesToRows,
  buildMarketBreadthRows,
  estimateBinanceMarketDataVolume,
  MARKET_FEATURE_INTERVAL_MS,
  normalizeBinanceSymbols,
  normalizeMarketFeatureInterval,
} from '../lib/binanceMarketData';

args.example(
  'yarn cli:node8g binance:market-ingest --all --symbols BTCUSDT,ETHUSDT --days 0.05 --interval 1m --write',
  'Ingest Binance public market breadth and historical aggTrades buckets',
);

args.option(
  ['s', 'symbols'],
  'Comma-separated target symbols',
  'BTCUSDT,ETHUSDT',
);
args.option(['i', 'interval'], 'Aggregation interval: 1m,5m,15m,1h', '1m');
args.option(['d', 'days'], 'Lookback window in days', '1');
args.option(['h', 'hours'], 'Lookback window in hours; overrides --days');
args.option(['a', 'aggTrades'], 'Fetch and bucket Binance aggTrades');
args.option(
  ['b', 'breadth'],
  'Build alt-basket market breadth from Binance klines',
);
args.option(['A', 'all'], 'Enable aggTrades and breadth');
args.option(
  ['w', 'write'],
  'Write rows to Timescale; without this flag only estimate',
);
args.option(
  ['M', 'batchMinutes'],
  'aggTrades request window size in minutes',
  15,
);
args.option(
  ['r', 'requestDelayMs'],
  'Delay between Binance aggTrades requests',
  75,
);

const flags = args.parse(process.argv);

const asFloat = (value: unknown, fallback: number) => {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const asInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const sleep = (ms: number) =>
  ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();

const intervalToConnectorInterval = (interval: MarketFeatureInterval) => {
  if (interval === '1m') return '1';
  if (interval === '5m') return '5';
  if (interval === '15m') return '15';
  return '60';
};

const fetchAggTradesForWindow = async ({
  connector,
  symbol,
  fromMs,
  toMs,
  batchMinutes,
  requestDelayMs,
}: {
  connector: Awaited<ReturnType<(typeof connectors)[ConnectorNames.Binance]>>;
  symbol: string;
  fromMs: number;
  toMs: number;
  batchMinutes: number;
  requestDelayMs: number;
}) => {
  if (!connector.getAggTrades) return [] as AggTrade[];

  const rows: AggTrade[] = [];
  const batchMs = Math.max(1, batchMinutes) * 60_000;
  let cursor = fromMs;

  while (cursor <= toMs) {
    const endTime = Math.min(toMs, cursor + batchMs - 1);
    let pageCursor = cursor;

    while (pageCursor <= endTime) {
      const page = await connector.getAggTrades({
        symbol,
        startTime: pageCursor,
        endTime,
        limit: 1000,
      });
      if (!page.length) break;

      rows.push(...page);
      const lastTs = page[page.length - 1]?.timestamp;
      if (page.length < 1000 || !Number.isFinite(lastTs)) break;

      const nextCursor = Math.max(pageCursor + 1, Number(lastTs) + 1);
      if (nextCursor > endTime) break;
      pageCursor = nextCursor;
      await sleep(requestDelayMs);
    }

    cursor = endTime + 1;
    await sleep(requestDelayMs);
  }

  return rows;
};

const printEstimate = (
  estimate: ReturnType<typeof estimateBinanceMarketDataVolume>,
) => {
  console.log(chalk.cyan('Binance market ingest estimate'));
  console.log(`interval: ${estimate.interval}`);
  console.log(`days: ${estimate.days}`);
  console.log(`target symbols: ${estimate.symbols}`);
  console.log(`bucket rows/symbol: ${estimate.bucketRowsPerSymbol}`);
  console.log(`aggTrades bucket rows: ${estimate.aggTradeBucketRows}`);
  console.log(`breadth symbols: ${estimate.breadthSymbols}`);
  console.log(`breadth candle reads: ${estimate.breadthCandleRows}`);
  console.log(`breadth rows: ${estimate.breadthRows}`);
  console.log(`estimated stored rows: ${estimate.estimatedStoredRows}`);
};

export const main = async () => {
  const symbols = normalizeBinanceSymbols(flags.symbols);
  const interval = normalizeMarketFeatureInterval(flags.interval);
  const hours = flags.hours == null ? null : asFloat(flags.hours, 0);
  const days = hours != null && hours > 0 ? hours / 24 : asFloat(flags.days, 1);
  const breadthUniverses = getBinanceBreadthUniverses();
  const batchMinutes = asInt(flags.batchMinutes, 15);
  const requestDelayMs = asInt(flags.requestDelayMs, 75);
  const includeAll = Boolean(flags.all);
  const includeAggTrades = includeAll || Boolean(flags.aggTrades);
  const includeBreadth = includeAll || Boolean(flags.breadth);
  const anyMode = includeAggTrades || includeBreadth;
  const modes = {
    includeAggTrades: anyMode ? includeAggTrades : true,
    includeBreadth: anyMode ? includeBreadth : true,
  };

  if (!symbols.length) throw new Error('No symbols provided');

  const estimate = estimateBinanceMarketDataVolume({
    symbols,
    days,
    interval,
    includeAggTrades: modes.includeAggTrades,
    includeBreadth: modes.includeBreadth,
    breadthSizes: breadthUniverses.map(({ size }) => size),
  });
  printEstimate(estimate);

  if (!flags.write) {
    console.log(chalk.yellow('Dry run only. Pass --write to ingest.'));
    return;
  }

  await waitForDbReady();
  const connector = await connectors[ConnectorNames.Binance]({
    userName: 'root',
  });
  const toMs =
    Math.floor(Date.now() / MARKET_FEATURE_INTERVAL_MS[interval]) *
    MARKET_FEATURE_INTERVAL_MS[interval];
  const fromMs = toMs - days * 86_400_000;

  let aggTradesRaw = 0;
  let tradeFlowRows = 0;
  let breadthRows = 0;
  let breadthCandleRows = 0;

  if (modes.includeAggTrades) {
    for (const symbol of symbols) {
      process.stdout.write(chalk.cyan(`aggTrades ${symbol}... `));
      const trades = await fetchAggTradesForWindow({
        connector,
        symbol,
        fromMs,
        toMs,
        batchMinutes,
        requestDelayMs,
      });
      const rows = aggregateAggTradesToRows({ symbol, interval, trades });
      await upsertMarketTradeFlowRows(rows);
      aggTradesRaw += trades.length;
      tradeFlowRows += rows.length;
      process.stdout.write(
        `${trades.length} trades -> ${rows.length} buckets\n`,
      );
    }
  }

  if (modes.includeBreadth) {
    const breadthSymbols = breadthUniverses.at(-1)?.symbols ?? [];
    const connectorInterval = intervalToConnectorInterval(interval);
    const candlesBySymbol: Record<string, KlineChartData> = {};

    for (const symbol of breadthSymbols) {
      process.stdout.write(chalk.cyan(`breadth candles ${symbol}... `));
      const candles = await connector.kline({
        symbol,
        interval: connectorInterval as any,
        start: fromMs,
        end: toMs,
        silent: true,
      });
      candlesBySymbol[symbol] = candles;
      breadthCandleRows += candles.length;
      process.stdout.write(`${candles.length}\n`);
    }

    const btcCandles = await connector.kline({
      symbol: 'BTCUSDT',
      interval: connectorInterval as any,
      start: fromMs,
      end: toMs,
      silent: true,
    });
    for (const definition of breadthUniverses) {
      const symbolSet = new Set(definition.symbols);
      const universeCandles = Object.fromEntries(
        Object.entries(candlesBySymbol).filter(([symbol]) =>
          symbolSet.has(symbol),
        ),
      );
      const rows = buildMarketBreadthRows({
        universe: definition.universe,
        interval,
        candlesBySymbol: universeCandles,
        btcCandles,
      });
      await upsertMarketBreadthRows(rows);
      breadthRows += rows.length;
    }
  }

  console.log(chalk.green('Binance market ingest done'));
  console.log(`aggTrades raw rows: ${aggTradesRaw}`);
  console.log(`trade-flow bucket rows: ${tradeFlowRows}`);
  console.log(`breadth candle rows read: ${breadthCandleRows}`);
  console.log(`breadth rows: ${breadthRows}`);
  console.log(
    `stored rows: ${tradeFlowRows + breadthRows} (raw aggTrades are not stored)`,
  );
};
