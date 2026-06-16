import ProgressBar from 'progress';
import chalk from 'chalk';
import { ConnectorNames } from '@tradejs/connectors';
import { getConnectorCreatorByName } from '@tradejs/node/connectors';
import {
  getMarketBreadthCoverage,
  getMarketTradeFlowCoverage,
  upsertMarketBreadthRows,
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
  buildKlineTradeFlowRows,
  buildMarketBreadthRows,
  MARKET_FEATURE_INTERVAL_MS,
  selectBreadthUniverseFromTickers,
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
  const breadthLookbackDays = asFloat(
    process.env.BINANCE_MARKET_CONTEXT_BREADTH_BACKFILL_LOOKBACK_DAYS,
    3,
  );
  const breadthWarmupStartMs = startMs - breadthLookbackDays * DAY_MS;
  return {
    breadthStartMs:
      preloadStartMs == null
        ? breadthWarmupStartMs
        : Math.max(preloadStartMs, breadthWarmupStartMs),
    tradeFlowStartMs: preloadStartMs ?? startMs,
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

export const buildBreadthBackfillChunks = ({
  startMs,
  endMs,
  intervalMs,
  chunkDays,
}: {
  startMs: number;
  endMs: number;
  intervalMs: number;
  chunkDays: number;
}) => {
  const chunkMs = Math.max(intervalMs, chunkDays * DAY_MS);
  const warmupBars = Math.max(50, Math.ceil((DAY_MS * 2) / intervalMs));
  const warmupMs = warmupBars * intervalMs;
  const chunks: Array<{
    startMs: number;
    endMs: number;
    fetchStartMs: number;
  }> = [];
  let cursor = startMs;

  while (cursor <= endMs) {
    const chunkEndMs = Math.min(endMs, cursor + chunkMs - 1);
    chunks.push({
      startMs: cursor,
      endMs: chunkEndMs,
      fetchStartMs: Math.max(startMs, cursor - warmupMs),
    });
    cursor = chunkEndMs + 1;
  }

  return chunks;
};

export const buildTradeFlowBackfillChunks = ({
  startMs,
  endMs,
  intervalMs,
  chunkDays,
}: {
  startMs: number;
  endMs: number;
  intervalMs: number;
  chunkDays: number;
}) => {
  const chunkMs = Math.max(intervalMs, chunkDays * DAY_MS);
  const chunks: Array<{ startMs: number; endMs: number }> = [];
  let cursor = startMs;

  while (cursor <= endMs) {
    const chunkEndMs = Math.min(endMs, cursor + chunkMs - 1);
    chunks.push({ startMs: cursor, endMs: chunkEndMs });
    cursor = chunkEndMs + 1;
  }

  return chunks;
};

export const filterMissingBreadthBackfillChunks = ({
  chunks,
  coverage,
  intervalMs,
}: {
  chunks: Array<{ startMs: number; endMs: number; fetchStartMs: number }>;
  coverage?: { firstMs: number; lastMs: number; rows: number } | null;
  intervalMs: number;
}) =>
  chunks.filter(
    (chunk) =>
      !hasCoverage({
        coverage,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        intervalMs,
      }),
  );

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
    2,
  );
  const breadthLimit = asInt(
    process.env.BINANCE_MARKET_CONTEXT_BREADTH_LIMIT,
    30,
  );
  const breadthChunkDays = asFloat(
    process.env.BINANCE_MARKET_CONTEXT_BREADTH_CHUNK_DAYS,
    30,
  );
  const tradeFlowChunkDays = asFloat(
    process.env.BINANCE_MARKET_CONTEXT_TRADE_FLOW_CHUNK_DAYS,
    30,
  );
  const tradeFlowSource = String(
    process.env.BINANCE_MARKET_CONTEXT_TRADE_FLOW_SOURCE || 'klines',
  )
    .trim()
    .toLowerCase();
  const referenceSymbols = getReferenceSymbols().slice(0, symbolLimit);
  const skippedSymbols = Math.max(0, symbols.length - referenceSymbols.length);

  let tradeFlowRows = 0;
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

    const connectorInterval = marketIntervalToConnectorInterval(interval);
    const chunks = buildTradeFlowBackfillChunks({
      startMs: tradeFlowStartMs,
      endMs,
      intervalMs,
      chunkDays: tradeFlowChunkDays,
    });
    const chunkBar = missingSymbols.length
      ? new ProgressBar(
          'tradeFlow chunks :current/:total [:bar][:percent] :etas(s) rows=:rows skip=:skip chunk=:chunk :symbol',
          {
            total: Math.max(1, chunks.length * missingSymbols.length),
            width: 24,
          },
        )
      : null;
    let skippedTradeFlowChunks = 0;

    for (const symbol of missingSymbols) {
      const symbolCoverage = coverage.get(symbol);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        if (
          hasCoverage({
            coverage: symbolCoverage,
            startMs: chunk.startMs,
            endMs: chunk.endMs,
            intervalMs,
          })
        ) {
          skippedTradeFlowChunks += 1;
          chunkBar?.tick(1, {
            rows: tradeFlowRows,
            skip: skippedTradeFlowChunks,
            chunk: `${chunkIndex + 1}/${chunks.length}`,
            symbol,
          });
          continue;
        }

        const rows =
          tradeFlowSource === 'agg_trades'
            ? aggregateAggTradesToRows({
                symbol,
                interval,
                trades: await fetchAggTradesForWindow({
                  connector,
                  symbol,
                  fromMs: chunk.startMs,
                  toMs: chunk.endMs,
                  batchMinutes,
                  requestDelayMs,
                }),
              })
            : buildKlineTradeFlowRows({
                symbol,
                interval,
                candles: await connector.kline({
                  symbol,
                  interval: connectorInterval as Interval,
                  start: chunk.startMs,
                  end: chunk.endMs,
                  silent: true,
                }),
              });
        const boundedRows = rows.filter((row) => {
          const ts = row.ts.getTime();
          return ts >= chunk.startMs && ts <= chunk.endMs;
        });
        await upsertMarketTradeFlowRows(boundedRows);
        tradeFlowRows += boundedRows.length;
        chunkBar?.tick(1, {
          rows: tradeFlowRows,
          skip: skippedTradeFlowChunks,
          chunk: `${chunkIndex + 1}/${chunks.length}`,
          symbol,
        });
      }
      bar.tick(1, {
        rows: tradeFlowRows,
        skip: referenceSymbols.length - missingSymbols.length + skippedSymbols,
        symbol,
      });
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
      const chunks = buildBreadthBackfillChunks({
        startMs: breadthStartMs,
        endMs,
        intervalMs,
        chunkDays: breadthChunkDays,
      });
      const missingChunks = filterMissingBreadthBackfillChunks({
        chunks,
        coverage,
        intervalMs,
      });
      const bar = new ProgressBar(
        'breadth :current/:total [:bar][:percent] :etas(s) candles=:candles skip=:skip chunk=:chunk :symbol',
        {
          total: Math.max(1, missingChunks.length * breadthSymbols.length),
          width: 24,
        },
      );
      let candlesRead = 0;
      let skippedBreadthChunks = chunks.length - missingChunks.length;
      if (!missingChunks.length) {
        bar.tick(1, {
          candles: 0,
          skip: skippedBreadthChunks,
          chunk: 'cached',
          symbol: universe,
        });
      }
      for (
        let chunkIndex = 0;
        chunkIndex < missingChunks.length;
        chunkIndex += 1
      ) {
        const chunk = missingChunks[chunkIndex];
        const originalChunkIndex = chunks.findIndex(
          (item) =>
            item.startMs === chunk.startMs && item.endMs === chunk.endMs,
        );
        const candlesBySymbol: Record<string, KlineChartData> = {};

        for (const symbol of breadthSymbols) {
          const candles = await connector.kline({
            symbol,
            interval: connectorInterval as Interval,
            start: chunk.fetchStartMs,
            end: chunk.endMs,
            silent: true,
          });
          candlesBySymbol[symbol] = candles;
          candlesRead += candles.length;
          bar.tick(1, {
            candles: candlesRead,
            skip: skippedBreadthChunks,
            chunk: `${originalChunkIndex + 1}/${chunks.length}`,
            symbol,
          });
        }
        const btcCandles = await connector.kline({
          symbol: 'BTCUSDT',
          interval: connectorInterval as Interval,
          start: chunk.fetchStartMs,
          end: chunk.endMs,
          silent: true,
        });
        const rows = buildMarketBreadthRows({
          universe,
          interval,
          candlesBySymbol,
          btcCandles,
        }).filter((row) => {
          const ts = row.ts.getTime();
          return ts >= chunk.startMs && ts <= chunk.endMs;
        });
        await upsertMarketBreadthRows(rows);
        breadthRows += rows.length;
      }
    } else {
      console.log(chalk.gray(`breadth cached: universe=${universe}`));
    }
  }

  console.log(
    chalk.green(
      `binance market context backfill done: tradeFlowRows=${tradeFlowRows}, depthRows=0, breadthRows=${breadthRows}, skippedSymbols=${skippedSymbols}`,
    ),
  );

  return {
    skipped: false,
    tradeFlowRows,
    depthRows: 0,
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
