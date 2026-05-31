import 'dotenv/config';
import args from 'args';
import chalk from 'chalk';
import { connectors, ConnectorNames } from '@tradejs/connectors';
import {
  upsertMarketBreadthRows,
  upsertMarketOrderBookDepthRows,
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
  selectBreadthUniverseFromTickers,
  summarizeOrderBookDepth,
} from '../lib/binanceMarketData';

args.example(
  'yarn cli:node8g binance:market-ingest --all --symbols BTCUSDT,ETHUSDT --days 0.05 --interval 1m --write',
  'Ingest Binance public market breadth, aggTrades buckets, and depth snapshots',
);

args.option(
  ['s', 'symbols'],
  'Comma-separated target symbols',
  'BTCUSDT,ETHUSDT',
);
args.option(['i', 'interval'], 'Aggregation interval: 1m,5m,15m,1h', '1m');
args.option(['d', 'days'], 'Lookback window in days', '1');
args.option('hours', 'Lookback window in hours; overrides --days');
args.option('aggTrades', 'Fetch and bucket Binance aggTrades');
args.option('depth', 'Fetch current full order book depth snapshots');
args.option('breadth', 'Build alt-basket market breadth from Binance klines');
args.option('all', 'Enable aggTrades, depth, and breadth');
args.option(
  'write',
  'Write rows to Timescale; without this flag only estimate',
);
args.option('breadthLimit', 'Top USDT symbols used for breadth universe', 30);
args.option('depthLimit', 'Binance order book depth limit', 100);
args.option('batchMinutes', 'aggTrades request window size in minutes', 15);
args.option('requestDelayMs', 'Delay between Binance aggTrades requests', 75);

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
  console.log(`depth snapshot rows: ${estimate.depthSnapshotRows}`);
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
  const breadthLimit = asInt(flags.breadthLimit, 30);
  const depthLimit = asInt(flags.depthLimit, 100) as 100;
  const batchMinutes = asInt(flags.batchMinutes, 15);
  const requestDelayMs = asInt(flags.requestDelayMs, 75);
  const includeAll = Boolean(flags.all);
  const includeAggTrades = includeAll || Boolean(flags.aggTrades);
  const includeDepth = includeAll || Boolean(flags.depth);
  const includeBreadth = includeAll || Boolean(flags.breadth);
  const anyMode = includeAggTrades || includeDepth || includeBreadth;
  const modes = {
    includeAggTrades: anyMode ? includeAggTrades : true,
    includeDepth: anyMode ? includeDepth : true,
    includeBreadth: anyMode ? includeBreadth : true,
  };

  if (!symbols.length) throw new Error('No symbols provided');

  const estimate = estimateBinanceMarketDataVolume({
    symbols,
    days,
    interval,
    includeAggTrades: modes.includeAggTrades,
    includeDepth: modes.includeDepth,
    includeBreadth: modes.includeBreadth,
    breadthLimit,
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
  let depthRows = 0;
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

  if (modes.includeDepth && connector.getOrderBookDepth) {
    for (const symbol of symbols) {
      const depth = await connector.getOrderBookDepth({
        symbol,
        limit: depthLimit as any,
      });
      if (!depth) continue;
      const row = summarizeOrderBookDepth({ depth });
      await upsertMarketOrderBookDepthRows([row]);
      depthRows += 1;
      console.log(
        chalk.cyan(
          `depth ${symbol}: levels=${row.rawBidLevels}/${row.rawAskLevels} spreadBps=${String(
            row.spreadBps ?? 'n/a',
          )}`,
        ),
      );
    }
  }

  if (modes.includeBreadth) {
    const tickers = await connector.getTickers();
    const breadthSymbols = selectBreadthUniverseFromTickers(
      tickers,
      breadthLimit,
    );
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

    const universe = `binance_top${breadthSymbols.length}_usdt`;
    const rows = buildMarketBreadthRows({
      universe,
      interval,
      candlesBySymbol,
    });
    await upsertMarketBreadthRows(rows);
    breadthRows += rows.length;
  }

  console.log(chalk.green('Binance market ingest done'));
  console.log(`aggTrades raw rows: ${aggTradesRaw}`);
  console.log(`trade-flow bucket rows: ${tradeFlowRows}`);
  console.log(`depth snapshot rows: ${depthRows}`);
  console.log(`breadth candle rows read: ${breadthCandleRows}`);
  console.log(`breadth rows: ${breadthRows}`);
  console.log(
    `stored rows: ${tradeFlowRows + depthRows + breadthRows} (raw aggTrades are not stored)`,
  );
};
