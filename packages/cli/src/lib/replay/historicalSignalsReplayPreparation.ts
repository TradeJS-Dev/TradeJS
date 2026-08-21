import type {
  Interval,
  KlineChartData,
  KlineChartItem,
  RuntimeLineage,
  RuntimeStrategySelection,
  Signal,
  StrategyConfig,
  StrategyCreator,
} from '@tradejs/types';
import type { PreparedRunEnvironment } from '../runEnvironment';
import { buildReplayStrategyConfig } from './support';
import type { PortfolioReplayConnector } from './portfolioReplayConnector';
import {
  alignSymbolWithBtcReference,
  splitCandlesForReplayWindow,
} from '../marketData/windows';

export type ReplayRuntimeStrategy = {
  strategyName: string;
  strategyRevision: string;
  deploymentCompositionId: string;
  strategyPackage: string;
  strategyPackageVersion: string;
  strategyDependencyVersions: Record<string, string>;
  runtimePackageVersion: string;
  strategyCreator: StrategyCreator;
  strategyConfig: StrategyConfig;
  selection?: RuntimeStrategySelection;
  strategyResults: Record<
    string,
    { config?: Record<string, unknown> | null } | undefined
  >;
};

export type ReplayRuntimeLineageRecord = {
  strategy: string;
  symbol: string;
  deploymentId?: string;
  accountId?: string;
  lineage: RuntimeLineage;
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

export type SymbolReplayRuntime = {
  symbol: string;
  replayData: KlineChartData;
  btcReplayData: KlineChartData;
  ethReplayData: KlineChartData;
  currentIndex: number;
  strategies: Array<{
    strategyName: string;
    strategyConfig: StrategyConfig;
    runtimeLineage: RuntimeLineage;
    run: (
      candle: KlineChartItem,
      btcCandle: KlineChartItem,
      ethCandle?: KlineChartItem,
    ) => Promise<Signal | string | undefined>;
  }>;
};

export type HistoricalReplayPlan = {
  cycleSymbolsByTimestamp: Map<number, SymbolReplayRuntime[]>;
  orderedTimestamps: number[];
  sharedReplayKeyPrefixes: string[];
  runtimeLineages: ReplayRuntimeLineageRecord[];
};

export type HistoricalReplayPreparationContext = {
  userName: string;
  projectRoot: string;
  preparedRun: PreparedRunEnvironment;
  interval: Interval;
  connectorName: string;
  replayConnector: PortfolioReplayConnector;
  strategies: ReplayRuntimeStrategy[];
  references: {
    btcMarketData: KlineChartData;
    ethMarketData: KlineChartData;
    btcBinanceData: KlineChartData;
    btcCoinbaseData: KlineChartData;
  };
};

export type HistoricalReplayPreparationAdapters = {
  progress: {
    tick(tokens: { skipped: string; symbol: string }): void;
  };
  display: {
    skipped(value: number): string;
    symbol(value: string): string;
  };
  buildLineage(params: {
    projectRoot: string;
    strategyName: string;
    strategyRevision: string;
    deploymentCompositionId: string;
    strategyPackageVersion: string;
    strategyDependencyVersions: Record<string, string>;
    runtimePackageVersion: string;
    config: {
      configId: string;
      strategyConfig: StrategyConfig;
      symbolResultConfig: Record<string, unknown> | null;
    };
    runContext: {
      connectorName: string;
      interval: string;
      universe: string | null;
    };
  }): Promise<RuntimeLineage>;
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

const strategyIncludesSymbol = (
  strategy: Pick<ReplayRuntimeStrategy, 'selection'>,
  symbol: string,
) => {
  const tickers = strategy.selection?.tickers;
  if (!tickers) return true;
  const normalizedSymbol = symbol.trim().toUpperCase();
  return tickers.some(
    (ticker) => ticker.trim().toUpperCase() === normalizedSymbol,
  );
};

const buildSymbolSharedReplayKey = ({
  userName,
  connectorName,
  interval,
  symbol,
  start,
  end,
}: {
  userName: string;
  connectorName: string;
  interval: Interval;
  symbol: string;
  start: number;
  end: number;
}) =>
  ['replay', userName, connectorName, symbol, interval, start, end].join(':');

export const prepareHistoricalReplay = async (
  context: HistoricalReplayPreparationContext,
  adapters: HistoricalReplayPreparationAdapters,
): Promise<HistoricalReplayPlan> => {
  const {
    userName,
    projectRoot,
    preparedRun,
    interval,
    connectorName,
    replayConnector,
    strategies,
    references,
  } = context;
  const cycleSymbolsByTimestamp = new Map<number, SymbolReplayRuntime[]>();
  const sharedReplayKeyPrefixes: string[] = [];
  const runtimeLineages: ReplayRuntimeLineageRecord[] = [];
  let skippedSymbols = 0;

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
      btcData: references.btcMarketData,
      ethData: references.ethMarketData,
      btcBinanceData: references.btcBinanceData,
      btcCoinbaseData: references.btcCoinbaseData,
      start: preparedRun.window.start,
      preloadStart: preparedRun.preloadStart,
    });

    if (!preparedData.replayData.length || !preparedData.btcReplayData.length) {
      skippedSymbols += 1;
      adapters.progress.tick({
        skipped: adapters.display.skipped(skippedSymbols),
        symbol: adapters.display.symbol(symbol),
      });
      continue;
    }

    const sharedIndicatorsReplayKey = buildSymbolSharedReplayKey({
      userName,
      connectorName,
      interval,
      symbol,
      start: preparedRun.window.start,
      end: preparedRun.window.end,
    });
    sharedReplayKeyPrefixes.push(sharedIndicatorsReplayKey);

    const strategiesForSymbol = await Promise.all(
      strategies
        .filter((strategy) => strategyIncludesSymbol(strategy, symbol))
        .map(async (strategy) => {
          const runtimeLineage = await adapters.buildLineage({
            projectRoot,
            strategyName: strategy.strategyName,
            strategyRevision: strategy.strategyRevision,
            deploymentCompositionId: strategy.deploymentCompositionId,
            strategyPackageVersion: strategy.strategyPackageVersion,
            strategyDependencyVersions: strategy.strategyDependencyVersions,
            runtimePackageVersion: strategy.runtimePackageVersion,
            config: {
              configId: strategy.strategyRevision,
              strategyConfig: strategy.strategyConfig,
              symbolResultConfig:
                strategy.strategyResults?.[symbol]?.config ?? null,
            },
            runContext: {
              connectorName: connectorName.toLowerCase(),
              interval: String(interval),
              universe: preparedRun.universe ?? null,
            },
          });
          runtimeLineages.push({
            strategy: strategy.strategyName,
            symbol,
            ...(preparedRun.deploymentId
              ? { deploymentId: preparedRun.deploymentId }
              : {}),
            ...(preparedRun.accountId
              ? { accountId: preparedRun.accountId }
              : {}),
            lineage: runtimeLineage,
          });

          return {
            strategyName: strategy.strategyName,
            strategyConfig: strategy.strategyConfig,
            runtimeLineage,
            run: await strategy.strategyCreator({
              userName,
              connectorName,
              runtimeConfigId: strategy.strategyRevision,
              strategyRevision: strategy.strategyRevision,
              runtimeLineage,
              universe: preparedRun.universe,
              accountId: preparedRun.accountId,
              deploymentId: preparedRun.deploymentId,
              config: buildReplayStrategyConfig({
                strategyConfig: strategy.strategyConfig,
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
          };
        }),
    );

    const symbolRuntime: SymbolReplayRuntime = {
      symbol,
      replayData: preparedData.replayData,
      btcReplayData: preparedData.btcReplayData,
      ethReplayData: preparedData.ethReplayData,
      currentIndex: 0,
      strategies: strategiesForSymbol,
    };
    adapters.progress.tick({
      skipped: adapters.display.skipped(skippedSymbols),
      symbol: adapters.display.symbol(symbol),
    });

    for (const candle of preparedData.replayData) {
      const bucket = cycleSymbolsByTimestamp.get(candle.timestamp) ?? [];
      bucket.push(symbolRuntime);
      cycleSymbolsByTimestamp.set(candle.timestamp, bucket);
    }
  }

  return {
    cycleSymbolsByTimestamp,
    orderedTimestamps: [...cycleSymbolsByTimestamp.keys()].sort(
      (left, right) => left - right,
    ),
    sharedReplayKeyPrefixes,
    runtimeLineages,
  };
};
