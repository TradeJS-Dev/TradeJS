import ProgressBar from 'progress';
import chalk from 'chalk';
import { ConnectorNames } from '@tradejs/connectors';
import { getConnectorCreatorByName } from '@tradejs/node/connectors';
import {
  getMarketBreadthCoverage,
  getMarketTradeFlowCoverage,
  upsertMarketBreadthRows,
  upsertMarketOrderBookDepthRows,
  upsertMarketTradeFlowRows,
  waitForDbReady,
} from '@tradejs/infra/timescale';
import type {
  AggTrade,
  Connector,
  ConnectorCreator,
  Interval,
  KlineChartData,
  MarketFeatureInterval,
} from '@tradejs/types';
import {
  aggregateAggTradesToRows,
  buildMarketBreadthRows,
  MARKET_FEATURE_INTERVAL_MS,
  selectBreadthUniverseFromTickers,
  summarizeOrderBookDepth,
} from './binanceMarketData';

type BackfillParams = {
  userName: string;
  projectRoot: string;
  symbols: string[];
  interval: Interval;
  startMs: number;
  endMs: number;
  preloadStartMs?: number;
};

type BinanceMarketBackfillResult = {
  skipped: boolean;
  tradeFlowRows: number;
  depthRows: number;
  breadthRows: number;
  skippedSymbols: number;
};

const DAY_MS = 86_400_000;

const sleep = (ms: number) =>
  ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();

const asInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const asFloat = (value: unknown, fallback: number) => {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseEnabledFlag = (value: unknown, defaultValue: boolean) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const uniqueSymbols = (symbols: string[]) => [
  ...new Set(symbols.map((item) => item.trim().toUpperCase()).filter(Boolean)),
];

const getReferenceSymbols = () => {
  const symbols = (
    process.env.BINANCE_MARKET_CONTEXT_REFERENCE_SYMBOLS || 'BTCUSDT,ETHUSDT'
  )
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return symbols.length ? [...new Set(symbols)] : ['BTCUSDT', 'ETHUSDT'];
};

const intervalToMarketFeatureInterval = (
  interval: Interval,
): MarketFeatureInterval => {
  const normalized = String(interval).trim().toLowerCase();
  if (normalized === '1' || normalized === '1m') return '1m';
  if (normalized === '5' || normalized === '5m') return '5m';
  if (normalized === '60' || normalized === '1h') return '1h';
  return '15m';
};

const marketIntervalToConnectorInterval = (interval: MarketFeatureInterval) => {
  if (interval === '1m') return '1';
  if (interval === '5m') return '5';
  if (interval === '1h') return '60';
  return '15';
};

const resolveWindow = ({
  startMs,
  endMs,
  preloadStartMs,
}: {
  startMs: number;
  endMs: number;
  preloadStartMs?: number;
}) => {
  const tradeFlowMaxDays = asFloat(
    process.env.BINANCE_MARKET_CONTEXT_TRADE_FLOW_BACKFILL_DAYS,
    0.1,
  );
  const breadthLookbackDays = asFloat(
    process.env.BINANCE_MARKET_CONTEXT_BREADTH_BACKFILL_LOOKBACK_DAYS,
    3,
  );
  const tradeFlowStartMs = Math.max(startMs, endMs - tradeFlowMaxDays * DAY_MS);
  const breadthWarmupStartMs = startMs - breadthLookbackDays * DAY_MS;
  return {
    breadthStartMs:
      preloadStartMs == null
        ? breadthWarmupStartMs
        : Math.max(preloadStartMs, breadthWarmupStartMs),
    tradeFlowStartMs,
    endMs,
  };
};

const hasCoverage = ({
  coverage,
  startMs,
  endMs,
  intervalMs,
}: {
  coverage?: { firstMs: number; lastMs: number; rows: number } | null;
  startMs: number;
  endMs: number;
  intervalMs: number;
}) => {
  if (!coverage) return false;
  const expectedRows = Math.max(1, Math.floor((endMs - startMs) / intervalMs));
  return (
    coverage.firstMs <= startMs + intervalMs &&
    coverage.lastMs >= endMs - intervalMs &&
    coverage.rows >= Math.floor(expectedRows * 0.9)
  );
};

const fetchAggTradesForWindow = async ({
  connector,
  symbol,
  fromMs,
  toMs,
  batchMinutes,
  requestDelayMs,
}: {
  connector: Connector;
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

const getBinanceConnector = async ({
  projectRoot,
  userName,
}: {
  projectRoot: string;
  userName: string;
}) => {
  const creator = await getConnectorCreatorByName(
    ConnectorNames.Binance,
    projectRoot,
  );
  if (!creator) {
    throw new Error(
      'Binance connector is required for market context backfill',
    );
  }
  return (creator as ConnectorCreator)({ userName });
};

export const shouldBackfillBinanceMarketContextForBacktest = ({
  aiEnabled,
  cacheOnly,
  mlEnabled,
}: {
  aiEnabled: boolean;
  cacheOnly: boolean;
  mlEnabled: boolean;
}) =>
  parseEnabledFlag(
    process.env.BINANCE_MARKET_CONTEXT_BACKFILL_ENABLED,
    (aiEnabled || mlEnabled) && !cacheOnly,
  );

export const shouldBackfillBinanceMarketContextForSignals = ({
  cacheOnly,
}: {
  cacheOnly: boolean;
}) =>
  parseEnabledFlag(
    process.env.BINANCE_MARKET_CONTEXT_BACKFILL_ENABLED,
    !cacheOnly,
  );

export const shouldBackfillBinanceMarketContextForReplay = ({
  cacheOnly,
}: {
  cacheOnly: boolean;
}) =>
  parseEnabledFlag(
    process.env.BINANCE_MARKET_CONTEXT_BACKFILL_ENABLED,
    !cacheOnly,
  );

const skippedBackfillResult = (): BinanceMarketBackfillResult => ({
  skipped: true,
  tradeFlowRows: 0,
  depthRows: 0,
  breadthRows: 0,
  skippedSymbols: 0,
});

const backfillBinanceMarketContext = async (
  params: BackfillParams,
  enabled: boolean,
): Promise<BinanceMarketBackfillResult> => {
  const symbols = uniqueSymbols(params.symbols);
  if (!enabled || !symbols.length) {
    return skippedBackfillResult();
  }

  const interval = intervalToMarketFeatureInterval(params.interval);
  const intervalMs = MARKET_FEATURE_INTERVAL_MS[interval];
  const { breadthStartMs, tradeFlowStartMs, endMs } = resolveWindow(params);
  if (endMs <= Math.min(breadthStartMs, tradeFlowStartMs)) {
    return skippedBackfillResult();
  }

  await waitForDbReady();
  const connector = await getBinanceConnector({
    projectRoot: params.projectRoot,
    userName: params.userName,
  });
  const includeTradeFlow = parseEnabledFlag(
    process.env.BINANCE_MARKET_CONTEXT_BACKFILL_TRADE_FLOW,
    true,
  );
  const includeDepth = parseEnabledFlag(
    process.env.BINANCE_MARKET_CONTEXT_BACKFILL_DEPTH,
    true,
  );
  const includeBreadth = parseEnabledFlag(
    process.env.BINANCE_MARKET_CONTEXT_BACKFILL_BREADTH,
    true,
  );
  const requestDelayMs = asInt(
    process.env.BINANCE_MARKET_CONTEXT_BACKFILL_REQUEST_DELAY_MS,
    75,
  );
  const batchMinutes = asInt(
    process.env.BINANCE_MARKET_CONTEXT_BACKFILL_BATCH_MINUTES,
    60,
  );
  const symbolLimit = asInt(
    process.env.BINANCE_MARKET_CONTEXT_TRADE_FLOW_SYMBOL_LIMIT,
    40,
  );
  const breadthLimit = asInt(
    process.env.BINANCE_MARKET_CONTEXT_BREADTH_LIMIT,
    30,
  );
  const depthLimit = asInt(
    process.env.BINANCE_MARKET_CONTEXT_DEPTH_LIMIT,
    100,
  ) as 100;
  const referenceSymbols = getReferenceSymbols().slice(0, symbolLimit);
  const skippedSymbols = Math.max(0, symbols.length - referenceSymbols.length);

  let tradeFlowRows = 0;
  let depthRows = 0;
  let breadthRows = 0;

  console.log(
    chalk.cyan(
      `binance market context backfill: requestedSymbols=${symbols.length}, referenceSymbols=${referenceSymbols.length}, interval=${interval}, tradeFlowWindow=${new Date(tradeFlowStartMs).toISOString()}..${new Date(endMs).toISOString()}, breadthWindow=${new Date(breadthStartMs).toISOString()}..${new Date(endMs).toISOString()}`,
    ),
  );

  if (includeTradeFlow && referenceSymbols.length) {
    const coverage = await getMarketTradeFlowCoverage({
      symbols: referenceSymbols,
      interval,
      startMs: tradeFlowStartMs,
      endMs,
    });
    const missingSymbols = referenceSymbols.filter(
      (symbol) =>
        !hasCoverage({
          coverage: coverage.get(symbol),
          startMs: tradeFlowStartMs,
          endMs,
          intervalMs,
        }),
    );
    const bar = new ProgressBar(
      'tradeFlow :current/:total [:bar][:percent] :etas(s) rows=:rows skip=:skip :symbol',
      {
        total: Math.max(1, missingSymbols.length),
        width: 24,
      },
    );
    if (!missingSymbols.length) {
      bar.tick(1, { rows: 0, skip: referenceSymbols.length, symbol: 'cached' });
    }

    for (const symbol of missingSymbols) {
      const trades = await fetchAggTradesForWindow({
        connector,
        symbol,
        fromMs: tradeFlowStartMs,
        toMs: endMs,
        batchMinutes,
        requestDelayMs,
      });
      const rows = aggregateAggTradesToRows({ symbol, interval, trades });
      await upsertMarketTradeFlowRows(rows);
      tradeFlowRows += rows.length;
      bar.tick(1, {
        rows: tradeFlowRows,
        skip: referenceSymbols.length - missingSymbols.length + skippedSymbols,
        symbol,
      });
    }
  }

  if (includeDepth && connector.getOrderBookDepth) {
    const bar = new ProgressBar(
      'depth :current/:total [:bar][:percent] :etas(s) rows=:rows :symbol',
      {
        total: Math.max(1, referenceSymbols.length),
        width: 24,
      },
    );
    for (const symbol of referenceSymbols) {
      const depth = await connector.getOrderBookDepth({
        symbol,
        limit: depthLimit,
      });
      if (depth) {
        await upsertMarketOrderBookDepthRows([
          summarizeOrderBookDepth({ depth }),
        ]);
        depthRows += 1;
      }
      bar.tick(1, { rows: depthRows, symbol });
      await sleep(requestDelayMs);
    }
  }

  if (includeBreadth) {
    const tickers = await connector.getTickers();
    const breadthSymbols = selectBreadthUniverseFromTickers(
      tickers,
      breadthLimit,
    );
    const universe = `binance_top${breadthSymbols.length}_usdt`;
    const coverage = await getMarketBreadthCoverage({
      universe,
      interval,
      startMs: breadthStartMs,
      endMs,
    });
    const hasBtcAltMetrics =
      (coverage?.btcAltMetricsRows ?? 0) >=
      Math.floor(Math.max(1, coverage?.rows ?? 0) * 0.9);
    if (
      !hasCoverage({
        coverage,
        startMs: breadthStartMs,
        endMs,
        intervalMs,
      }) ||
      !hasBtcAltMetrics
    ) {
      const connectorInterval = marketIntervalToConnectorInterval(interval);
      const candlesBySymbol: Record<string, KlineChartData> = {};
      const bar = new ProgressBar(
        'breadth :current/:total [:bar][:percent] :etas(s) candles=:candles :symbol',
        {
          total: Math.max(1, breadthSymbols.length),
          width: 24,
        },
      );
      let candlesRead = 0;
      for (const symbol of breadthSymbols) {
        const candles = await connector.kline({
          symbol,
          interval: connectorInterval as Interval,
          start: breadthStartMs,
          end: endMs,
          silent: true,
        });
        candlesBySymbol[symbol] = candles;
        candlesRead += candles.length;
        bar.tick(1, { candles: candlesRead, symbol });
      }
      const btcCandles = await connector.kline({
        symbol: 'BTCUSDT',
        interval: connectorInterval as Interval,
        start: breadthStartMs,
        end: endMs,
        silent: true,
      });
      const rows = buildMarketBreadthRows({
        universe,
        interval,
        candlesBySymbol,
        btcCandles,
      });
      await upsertMarketBreadthRows(rows);
      breadthRows += rows.length;
    } else {
      console.log(chalk.gray(`breadth cached: universe=${universe}`));
    }
  }

  console.log(
    chalk.green(
      `binance market context backfill done: tradeFlowRows=${tradeFlowRows}, depthRows=${depthRows}, breadthRows=${breadthRows}, skippedSymbols=${skippedSymbols}`,
    ),
  );

  return {
    skipped: false,
    tradeFlowRows,
    depthRows,
    breadthRows,
    skippedSymbols,
  };
};

export const backfillBinanceMarketContextForBacktest = (
  params: BackfillParams,
) => backfillBinanceMarketContext(params, true);

export const backfillBinanceMarketContextForSignals = (
  params: BackfillParams,
) => backfillBinanceMarketContext(params, true);

export const backfillBinanceMarketContextForReplay = (params: BackfillParams) =>
  backfillBinanceMarketContext(params, true);
