import chalk from 'chalk';
import ProgressBar from 'progress';
import { calculateStatsFull } from '@tradejs/core/backtest';
import {
  releaseStrategyIndicatorsReplayCache,
  releaseStrategyReplayCache,
} from '@tradejs/core/strategies';
import { formatUnix } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import {
  getConnectorCreatorByName,
  DEFAULT_CONNECTOR_NAME,
} from '@tradejs/node/connectors';
import { loadTradejsConfig } from '@tradejs/node/cli';
import {
  enrichSignalWithBinanceMarketContext,
  enrichSignalWithGlobalMarketContext,
  getStrategyCreator,
} from '@tradejs/node/strategies';
import type { TradejsConfigHooks } from '@tradejs/core/config';
import {
  Candle,
  Connector,
  ConnectorCreator,
  Interval,
  KlineChartData,
  KlineChartItem,
  OrderLogData,
  PositionLogData,
  Signal,
  StrategyConfig,
  StrategyCreator,
  TestStat,
} from '@tradejs/types';
import { PreparedRunEnvironment } from '../runEnvironment';
import { replayProjectRoot, replayUserName } from './cliConfig';
import { buildReplayStrategyConfig } from './support';
import {
  PortfolioReplayConnector,
  createPortfolioReplayConnector,
} from './portfolioReplayConnector';
import {
  alignSymbolWithBtcReference,
  splitCandlesForReplayWindow,
} from '../marketData/windows';
import {
  invokeAfterSignalsHooks,
  invokeBeforeSignalsHooks,
} from '../signals/hooks';

type ReplayRuntimeStrategy = {
  strategyName: string;
  strategyCreator: StrategyCreator;
  strategyConfig: StrategyConfig;
};

type SymbolPreparedData = {
  prevData: KlineChartData;
  btcPrevData: KlineChartData;
  ethPrevData: KlineChartData;
  replayData: KlineChartData;
  btcReplayData: KlineChartData;
  ethReplayData: KlineChartData;
  btcBinancePrevData: KlineChartData;
  btcCoinbasePrevData: KlineChartData;
};

type SymbolReplayRuntime = {
  symbol: string;
  replayData: KlineChartData;
  btcReplayData: KlineChartData;
  ethReplayData: KlineChartData;
  currentIndex: number;
  strategies: Array<{
    strategyName: string;
    strategyConfig: StrategyConfig;
    run: (
      candle: KlineChartItem,
      btcCandle: KlineChartItem,
      ethCandle?: KlineChartItem,
    ) => Promise<Signal | string | undefined>;
  }>;
};

export type ReplayStrategyRunArtifacts = {
  strategyName: string;
  strategyConfig: StrategyConfig;
  orderLog: OrderLogData;
  positionLog: PositionLogData;
  stat: TestStat | null;
};

export type HistoricalSignalsReplayResult = {
  strategies: ReplayStrategyRunArtifacts[];
  signals: Signal[];
  orderLog: OrderLogData;
  positionLog: PositionLogData;
  cycleCount: number;
  abortedCycles: number;
};

const loadRuntimeStrategies = async (
  runtimeStrategies: Array<{
    strategyName: string;
    strategyConfig: StrategyConfig;
  }>,
): Promise<ReplayRuntimeStrategy[]> => {
  const strategies = await Promise.all(
    runtimeStrategies.map(async ({ strategyName, strategyConfig }) => {
      const strategyCreator = await getStrategyCreator(
        strategyName,
        replayProjectRoot,
      );
      if (!strategyCreator) {
        throw new Error(`Unknown strategy: ${strategyName}`);
      }

      return {
        strategyName,
        strategyCreator,
        strategyConfig,
      };
    }),
  );

  return strategies;
};

const loadReferenceConnector = async (connectorName: string) => {
  const connectorFactory = await getConnectorCreatorByName(
    connectorName,
    replayProjectRoot,
  );
  if (!connectorFactory) {
    throw new Error(`Connector "${connectorName}" is not registered`);
  }

  return await (connectorFactory as ConnectorCreator)({
    userName: replayUserName,
  });
};

const buildPreparedData = ({
  data,
  btcData,
  ethData,
  btcBinanceData,
  btcCoinbaseData,
  start,
  preloadStart,
}: {
  data: KlineChartData;
  btcData: KlineChartData;
  ethData: KlineChartData;
  btcBinanceData: KlineChartData;
  btcCoinbaseData: KlineChartData;
  start: number;
  preloadStart: number;
}): SymbolPreparedData => {
  const { prevData: prevDataRaw, replayData: replayDataRaw } =
    splitCandlesForReplayWindow(data, start, preloadStart);
  const { prevData: btcPrevDataRaw, replayData: btcReplayDataRaw } =
    splitCandlesForReplayWindow(btcData, start, preloadStart);
  const { prevData: ethPrevDataRaw, replayData: ethReplayDataRaw } =
    splitCandlesForReplayWindow(ethData, start, preloadStart);
  const { prevData: btcBinancePrevDataRaw } = splitCandlesForReplayWindow(
    btcBinanceData,
    start,
    preloadStart,
  );
  const { prevData: btcCoinbasePrevDataRaw } = splitCandlesForReplayWindow(
    btcCoinbaseData,
    start,
    preloadStart,
  );

  const { alignedCoinCandles: prevData, alignedBtcCandles: btcPrevData } =
    alignSymbolWithBtcReference(prevDataRaw, btcPrevDataRaw);
  const { alignedCoinCandles: replayData, alignedBtcCandles: btcReplayData } =
    alignSymbolWithBtcReference(replayDataRaw, btcReplayDataRaw);
  const { alignedBtcCandles: ethPrevData } = alignSymbolWithBtcReference(
    prevData,
    ethPrevDataRaw,
  );
  const { alignedBtcCandles: ethReplayData } = alignSymbolWithBtcReference(
    replayData,
    ethReplayDataRaw,
  );
  const { alignedBtcCandles: btcBinancePrevData } = alignSymbolWithBtcReference(
    prevDataRaw,
    btcBinancePrevDataRaw,
  );
  const { alignedBtcCandles: btcCoinbasePrevData } =
    alignSymbolWithBtcReference(prevDataRaw, btcCoinbasePrevDataRaw);

  return {
    prevData,
    btcPrevData,
    ethPrevData,
    replayData,
    btcReplayData,
    ethReplayData,
    btcBinancePrevData,
    btcCoinbasePrevData,
  };
};

const buildAfterSignalsContext = ({
  connector,
  connectorName,
  tickers,
  runtimeStrategies,
  interval,
}: {
  connector: Connector;
  connectorName: string;
  tickers: string[];
  runtimeStrategies: ReplayRuntimeStrategy[];
  interval: Interval;
}) => ({
  connector,
  connectorName,
  userName: replayUserName,
  interval,
  tickers: [...tickers],
  runtimeStrategies: runtimeStrategies.map(
    ({ strategyName, strategyConfig }) => ({
      strategyName,
      strategyConfig,
    }),
  ),
});

const buildSymbolSharedReplayKey = ({
  connectorName,
  interval,
  symbol,
  start,
  end,
}: {
  connectorName: string;
  interval: Interval;
  symbol: string;
  start: number;
  end: number;
}) =>
  ['replay', replayUserName, connectorName, symbol, interval, start, end].join(
    ':',
  );

export const runHistoricalSignalsReplay = async ({
  preparedRun,
  interval,
  runtimeStrategies,
}: {
  preparedRun: PreparedRunEnvironment;
  interval: Interval;
  runtimeStrategies: Array<{
    strategyName: string;
    strategyConfig: StrategyConfig;
  }>;
}): Promise<HistoricalSignalsReplayResult> => {
  const startedAt = Date.now();
  const signals: Signal[] = [];
  const projectConfig = await loadTradejsConfig(replayProjectRoot);
  const projectHooks = projectConfig.hooks;
  const loadedStrategies = await loadRuntimeStrategies(runtimeStrategies);
  const replayConnector = createPortfolioReplayConnector(
    preparedRun.marketConnector,
  );
  const connectorName =
    String(
      (preparedRun.marketConnector as any)?.name || DEFAULT_CONNECTOR_NAME,
    ).trim() || DEFAULT_CONNECTOR_NAME;
  const binanceConnector =
    connectorName.toLowerCase() === DEFAULT_CONNECTOR_NAME.toLowerCase()
      ? await loadReferenceConnector('Binance')
      : preparedRun.marketConnector;
  const coinbaseConnector =
    connectorName.toLowerCase() === DEFAULT_CONNECTOR_NAME.toLowerCase()
      ? await loadReferenceConnector('Coinbase')
      : preparedRun.marketConnector;

  const [btcBinanceData, btcCoinbaseData] = await Promise.all([
    binanceConnector.kline({
      symbol: 'BTCUSDT',
      start: preparedRun.preloadStart,
      end: preparedRun.window.end,
      cacheOnly: true,
      interval: interval as any,
    }),
    coinbaseConnector.kline({
      symbol: 'BTCUSDT',
      start: preparedRun.preloadStart,
      end: preparedRun.window.end,
      cacheOnly: true,
      interval: interval as any,
    }),
  ]);
  const btcMarketData = await preparedRun.marketConnector.kline({
    symbol: 'BTCUSDT',
    start: preparedRun.preloadStart,
    end: preparedRun.window.end,
    cacheOnly: true,
    interval: interval as any,
  });
  const ethMarketData = await preparedRun.marketConnector.kline({
    symbol: 'ETHUSDT',
    start: preparedRun.preloadStart,
    end: preparedRun.window.end,
    cacheOnly: true,
    interval: interval as any,
  });

  const cycleSymbolsByTimestamp = new Map<number, SymbolReplayRuntime[]>();
  const sharedReplayKeyPrefixes: string[] = [];
  let preparedSymbols = 0;
  let skippedSymbols = 0;
  const prepareBar = new ProgressBar(
    'prepare :current/:total [:bar][:percent] skipped=:skipped :etas(s) :symbol',
    {
      total: preparedRun.tickers.length,
      width: 30,
    },
  );

  for (const symbol of preparedRun.tickers) {
    const data = await preparedRun.marketConnector.kline({
      symbol,
      start: preparedRun.preloadStart,
      end: preparedRun.window.end,
      cacheOnly: true,
      interval: interval as any,
    });

    const preparedData = buildPreparedData({
      data,
      btcData: btcMarketData,
      ethData: ethMarketData,
      btcBinanceData,
      btcCoinbaseData,
      start: preparedRun.window.start,
      preloadStart: preparedRun.preloadStart,
    });

    if (!preparedData.replayData.length || !preparedData.btcReplayData.length) {
      skippedSymbols += 1;
      prepareBar.tick(1, {
        skipped: chalk.yellow(skippedSymbols),
        symbol: chalk.gray(symbol),
      });
      continue;
    }

    const sharedIndicatorsReplayKey = buildSymbolSharedReplayKey({
      connectorName,
      interval,
      symbol,
      start: preparedRun.window.start,
      end: preparedRun.window.end,
    });
    sharedReplayKeyPrefixes.push(sharedIndicatorsReplayKey);

    const strategiesForSymbol = await Promise.all(
      loadedStrategies.map(
        async ({ strategyName, strategyCreator, strategyConfig }) => ({
          strategyName,
          strategyConfig,
          run: await strategyCreator({
            userName: replayUserName,
            connectorName,
            config: buildReplayStrategyConfig({
              strategyConfig,
              interval: interval as any,
            }),
            symbol,
            data: preparedData.prevData,
            btcData: preparedData.btcPrevData,
            ethData: preparedData.ethPrevData,
            btcBinanceData: preparedData.btcBinancePrevData,
            btcCoinbaseData: preparedData.btcCoinbasePrevData,
            connector: replayConnector,
            sharedIndicatorsReplayKey,
          }),
        }),
      ),
    );

    const symbolRuntime: SymbolReplayRuntime = {
      symbol,
      replayData: preparedData.replayData,
      btcReplayData: preparedData.btcReplayData,
      ethReplayData: preparedData.ethReplayData,
      currentIndex: 0,
      strategies: strategiesForSymbol,
    };
    preparedSymbols += 1;
    prepareBar.tick(1, {
      skipped: chalk.yellow(skippedSymbols),
      symbol: chalk.gray(symbol),
    });

    for (const candle of preparedData.replayData) {
      const bucket = cycleSymbolsByTimestamp.get(candle.timestamp) ?? [];
      bucket.push(symbolRuntime);
      cycleSymbolsByTimestamp.set(candle.timestamp, bucket);
    }
  }

  const orderedTimestamps = [...cycleSymbolsByTimestamp.keys()].sort(
    (left, right) => left - right,
  );
  const afterSignalsContextBase = buildAfterSignalsContext({
    connector: replayConnector,
    connectorName: preparedRun.connectorName,
    tickers: preparedRun.tickers,
    runtimeStrategies: loadedStrategies,
    interval,
  });

  let abortedCycles = 0;
  const cycleBar = new ProgressBar(
    'cycles  :current/:total [:bar][:percent] sig=:signals abort=:aborted :etas(s) :ts',
    {
      total: orderedTimestamps.length,
      width: 30,
    },
  );

  try {
    for (const [cycleIndex, timestamp] of orderedTimestamps.entries()) {
      const cycleStartedAt = Date.now();
      const cycleSymbols = cycleSymbolsByTimestamp.get(timestamp) ?? [];

      for (const symbolRuntime of cycleSymbols) {
        const candle = symbolRuntime.replayData[symbolRuntime.currentIndex];
        if (!candle || candle.timestamp !== timestamp) {
          continue;
        }

        await replayConnector.advanceMarket({
          symbol: symbolRuntime.symbol,
          candle,
        });
      }

      const beforeSignalsResult = await invokeBeforeSignalsHooks(
        projectHooks,
        afterSignalsContextBase,
      );
      if (beforeSignalsResult?.abort === true) {
        abortedCycles += 1;
        await invokeAfterSignalsHooks(projectHooks, {
          ...afterSignalsContextBase,
          signals: [],
          status: 'completed',
          durationMs: Date.now() - cycleStartedAt,
        });
        for (const symbolRuntime of cycleSymbols) {
          const candle = symbolRuntime.replayData[symbolRuntime.currentIndex];
          if (candle?.timestamp === timestamp) {
            symbolRuntime.currentIndex += 1;
          }
        }
        cycleBar.tick(1, {
          signals: chalk.cyan(signals.length),
          aborted: chalk.yellow(abortedCycles),
          ts: chalk.gray(formatUnix(timestamp)),
        });
        continue;
      }

      const cycleSignals: Signal[] = [];

      for (const symbolRuntime of cycleSymbols) {
        const candle = symbolRuntime.replayData[symbolRuntime.currentIndex];
        const btcCandle =
          symbolRuntime.btcReplayData[symbolRuntime.currentIndex];
        const ethCandle =
          symbolRuntime.ethReplayData[symbolRuntime.currentIndex];
        if (
          !candle ||
          !btcCandle ||
          candle.timestamp !== timestamp ||
          btcCandle.timestamp !== timestamp
        ) {
          continue;
        }

        for (const strategyRuntime of symbolRuntime.strategies) {
          const result = await strategyRuntime.run(
            candle,
            btcCandle,
            ethCandle?.timestamp === timestamp ? ethCandle : undefined,
          );
          if (result && typeof result !== 'string') {
            await enrichSignalWithBinanceMarketContext({
              signal: result,
              env: 'PARITY',
            });
            await enrichSignalWithGlobalMarketContext({
              signal: result,
              env: 'PARITY',
            });
            cycleSignals.push(result);
            signals.push(result);
          }
        }

        symbolRuntime.currentIndex += 1;
      }

      await invokeAfterSignalsHooks(projectHooks, {
        ...afterSignalsContextBase,
        signals: cycleSignals,
        status: 'completed',
        durationMs: Date.now() - cycleStartedAt,
      });
      cycleBar.tick(1, {
        signals: chalk.cyan(signals.length),
        aborted: chalk.yellow(abortedCycles),
        ts: chalk.gray(formatUnix(timestamp)),
      });
    }
  } finally {
    for (const keyPrefix of sharedReplayKeyPrefixes) {
      releaseStrategyIndicatorsReplayCache(keyPrefix);
      releaseStrategyReplayCache(keyPrefix);
    }
  }

  const artifacts = replayConnector.getReplayArtifacts();
  const strategies = loadedStrategies.map(
    ({ strategyName, strategyConfig }) => {
      const orderLog = artifacts.orderLogByStrategy.get(strategyName) ?? [];
      const positionLog =
        artifacts.positionLogByStrategy.get(strategyName) ?? [];
      return {
        strategyName,
        strategyConfig,
        orderLog,
        positionLog,
        stat: positionLog.length
          ? (calculateStatsFull(positionLog) as TestStat | null)
          : ({
              orders: 0,
              wins: 0,
              losses: 0,
              netProfit: 0,
              amount: 0,
            } as unknown as TestStat),
      };
    },
  );

  logger.info(
    chalk.gray(
      `signals replay historical cycles: ${orderedTimestamps.length} (aborted=${abortedCycles}) done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    ),
  );

  return {
    strategies,
    signals,
    orderLog: artifacts.orderLog,
    positionLog: artifacts.positionLog,
    cycleCount: orderedTimestamps.length,
    abortedCycles,
  };
};
