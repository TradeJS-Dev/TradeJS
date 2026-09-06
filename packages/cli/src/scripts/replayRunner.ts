import chalk from 'chalk';
import { TTL_1M } from '@tradejs/core/constants';
import { intervalToMs } from '@tradejs/core/data';
import { formatUnix, getBacktestPreloadStart } from '@tradejs/core/time';
import { getData, setData, redisKeys } from '@tradejs/infra/redis';
import { getDataEdgesForSymbols } from '@tradejs/infra/timescale/candles';
import {
  computeDeploymentCompositionId,
  computeStrategyRevision,
} from '@tradejs/node/runtimeStrategies';
import { preloadBinanceMarketContextForWindow } from '@tradejs/node/strategies';
import type { MarketFeatureInterval } from '@tradejs/types';
import { createTimestamp } from '../lib/runFormatting';
import {
  loadDeploymentReplayStrategies,
  mergeRuntimeStrategySelections,
  prepareRunEnvironment,
} from '../lib/runEnvironment';
import { prepareMarketContextForRun } from '../lib/marketContextPrepare';
import {
  setRuntimeCompareContext,
  getRunStartedAt,
  resetRunState,
  incrementSuccessTests,
  markTestsStarted,
} from '../lib/backtest/runState';
import {
  isReplayUpdateOnlyRun,
  replayDeploymentId,
  replayFlags,
  replayInterval,
  replayProjectRoot,
  replayRuntimeEvidencePath,
  replayUserName,
} from '../lib/replay/cliConfig';
import { loadReplayRuntimeEvidenceMetadata } from '../lib/replay/runtimeEvidenceSource';
import {
  activeRuntimeEvidenceStrategies,
  runtimeDeploymentFromEvidence,
} from '../lib/runtimeEvidenceDeployment';
import { REPLAY_RESULTS_CONFIG } from '../lib/replay/support';
import {
  HistoricalSignalsReplayResult,
  loadHistoricalReplayReferences,
  runHistoricalSignalsReplay,
} from '../lib/replay/historicalSignalsReplay';
import { buildReplayChartSnapshot } from '../lib/replay/chartSnapshot';
import { saveAndPrintReplayResultsByStrategy } from '../lib/replay/resultsReporting';
import { saveAndPrintReplayRuntimeComparison } from '../lib/replay/runtimeComparison';
import { writeReplayOutputReport } from '../lib/replay/outputReport';
import { writePortfolioReport } from '../lib/replay/portfolioReport';
import {
  compactHistoricalReplayResultForPortfolio,
  mergeHistoricalReplayResults,
} from '../lib/replay/historicalSignalsReplayResults';

export {
  buildReplayExchangeComparisonDetails,
  buildReplayRuntimeComparisonDetails,
  resolveReplayStrategyNameFromExchangeEntry,
} from '../lib/runtimeParityDetails';

export { compareExchangeEntriesToBacktest } from '../lib/replay/runtimeComparison';

export const prepareReplayBinanceMarketContext = async (preparedRun: {
  tickers: string[];
  window: { start: number; end: number };
  preloadStart: number;
  aiEnabled?: boolean;
  mlEnabled?: boolean;
  strategyNames?: string[];
}) => {
  await prepareMarketContextForRun({
    mode: 'replay',
    userName: replayUserName,
    projectRoot: replayProjectRoot,
    symbols: preparedRun.tickers,
    interval: replayInterval,
    startMs: preparedRun.window.start,
    endMs: preparedRun.window.end,
    preloadStartMs: preparedRun.preloadStart,
    cacheOnly: Boolean(replayFlags.cacheOnly),
    aiEnabled: preparedRun.aiEnabled,
    mlEnabled: preparedRun.mlEnabled,
    strategyNames: preparedRun.strategyNames,
    log: (message) => console.log(chalk.gray(message)),
  });
};

const replayMarketContextInterval = (): MarketFeatureInterval => {
  if (replayInterval === '1') return '1m';
  if (replayInterval === '5') return '5m';
  if (replayInterval === '60') return '1h';
  return '15m';
};

const cachedTickerSymbols = async ({
  connectorName,
  universe,
  accountId,
}: {
  connectorName: string;
  universe: string;
  accountId: string;
}) => {
  const connectorNames = [
    connectorName,
    ...(connectorName.toLowerCase() === 'bybit' ? ['ByBit'] : []),
  ];
  const keys = connectorNames.flatMap((name) => [
    redisKeys.tickerUniverse(replayUserName, name, universe, accountId),
    redisKeys.tickerUniverse(replayUserName, name, universe, 'default'),
    redisKeys.tickerUniverse(replayUserName, name),
  ]);
  for (const key of [...new Set(keys)]) {
    const cached = (await getData(key, null)) as {
      tickers?: Array<{ symbol?: unknown }>;
    } | null;
    const symbols = (cached?.tickers ?? [])
      .map((ticker) =>
        String(ticker.symbol ?? '')
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);
    if (symbols.length) return [...new Set(symbols)];
  }
  return [];
};

const finishReplay = async ({
  replayResult,
  tickers,
  connectorName,
  window,
  portfolioLineage,
}: {
  replayResult: HistoricalSignalsReplayResult;
  tickers: string[];
  connectorName: string;
  window: { start: number; end: number };
  portfolioLineage?: Record<string, unknown>;
}) => {
  const replayStrategySnapshot = await saveAndPrintReplayResultsByStrategy({
    replayResult,
    tickers,
  });
  const replayRuntimeComparison = replayFlags.portfolioReport
    ? null
    : await saveAndPrintReplayRuntimeComparison({
        liveStrategySummaries: replayStrategySnapshot.summaries,
        backtestEntries: replayStrategySnapshot.backtestEntries,
        replaySignals: replayResult.signals,
        replayLineages: replayResult.runtimeLineages,
        replayLineageScopes: replayResult.replayLineageScopes,
        runtimeEvidencePath: replayRuntimeEvidencePath,
      });

  const finishedAt = new Date();
  const durationSeconds = Number(
    ((Date.now() - getRunStartedAt()) / 1000).toFixed(2),
  );
  const timestamp = createTimestamp(finishedAt);
  const replayChartSnapshot = replayFlags.chart
    ? buildReplayChartSnapshot({
        replayResult,
        generatedAt: finishedAt.getTime(),
        runLabel: `${formatUnix(
          replayResult.orderLog[0]?.timestamp ?? finishedAt.getTime(),
        )} -> ${formatUnix(
          replayResult.orderLog[replayResult.orderLog.length - 1]?.timestamp ??
            finishedAt.getTime(),
        )}`,
      })
    : null;
  const replayKey = redisKeys.backtestResults(
    replayUserName,
    REPLAY_RESULTS_CONFIG,
    timestamp,
  );
  const outputReport = await writeReplayOutputReport({
    projectRoot: replayProjectRoot,
    timestamp,
    replayKey,
    userName: replayUserName,
    connectorName,
    interval: replayInterval,
    tickers,
    window,
    durationSeconds,
    replayResult,
    strategySnapshot: replayStrategySnapshot,
    runtimeComparison: replayRuntimeComparison,
  });
  console.log(chalk.green(`Replay report: ${outputReport.markdownPath}`));
  console.log(chalk.green(`Replay report JSON: ${outputReport.jsonPath}`));
  const portfolioReport = replayFlags.portfolioReport
    ? await writePortfolioReport({
        projectRoot: replayProjectRoot,
        timestamp: `${timestamp}${
          replayFlags.portfolioOutputSuffix
            ? `-${String(replayFlags.portfolioOutputSuffix).replace(/[^a-zA-Z0-9_-]/g, '')}`
            : ''
        }`,
        replayResult,
        window,
        lineage: portfolioLineage ?? {},
        command: process.argv.join(' '),
      })
    : null;
  if (portfolioReport) {
    console.log(chalk.green(`Portfolio report: ${portfolioReport.html}`));
    console.log(chalk.green(`Portfolio report JSON: ${portfolioReport.json}`));
  }

  await setData(
    replayKey,
    {
      config: REPLAY_RESULTS_CONFIG,
      mode: 'replay',
      user: replayUserName,
      startedAt: new Date(getRunStartedAt()).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds,
      results: [],
      resultsByTickers: [],
      resultsByStrategies: replayStrategySnapshot.summaries,
      runtimeComparison: replayRuntimeComparison,
      bestConfig: null,
      mergedConfig: null,
      successTests: replayResult.strategies.length,
      errors: [],
      errorTests: 0,
      cycleCount: replayResult.cycleCount,
      abortedCycles: replayResult.abortedCycles,
      signalsCount: replayResult.signals.length,
      replayLineage: replayResult.runtimeLineages,
      strategyCharts: replayChartSnapshot,
      outputReport,
      ...(portfolioReport ? { portfolioReport } : {}),
    },
    {
      expire: TTL_1M,
    },
  );

  if (replayChartSnapshot) {
    await Promise.all(
      replayChartSnapshot.strategies.map((card) =>
        setData(
          redisKeys.strategyChartCard(replayUserName, 'replay', card.cardId),
          card,
          {
            expire: TTL_1M,
          },
        ),
      ),
    );
  }

  process.exit();
};

export const replayBacktest = async () => {
  resetRunState();
  const evidenceMetadata = replayRuntimeEvidencePath
    ? await loadReplayRuntimeEvidenceMetadata({
        filePath: replayRuntimeEvidencePath,
        projectRoot: replayProjectRoot,
      })
    : null;
  if (evidenceMetadata && evidenceMetadata.userName !== replayUserName) {
    throw new Error(
      `Runtime evidence user mismatch: expected=${replayUserName}, actual=${evidenceMetadata.userName || 'missing'}`,
    );
  }
  const replayComposition = evidenceMetadata
    ? {
        deployment: runtimeDeploymentFromEvidence(evidenceMetadata.deployment),
        strategies: activeRuntimeEvidenceStrategies(
          evidenceMetadata.deployment,
        ).map(
          ({
            strategyName,
            strategyRevision,
            strategyPackage,
            strategyPackageVersion,
            strategyDependencyVersions,
            runtimePackageVersion,
            strategyConfig,
            selection,
          }) => ({
            strategyName,
            strategyRevision,
            deploymentCompositionId:
              evidenceMetadata.deployment.deploymentCompositionId,
            strategyPackage,
            strategyPackageVersion,
            strategyDependencyVersions,
            runtimePackageVersion,
            strategyConfig,
            ...(selection ? { selection } : {}),
          }),
        ),
      }
    : await loadDeploymentReplayStrategies({
        userName: replayUserName,
        projectRoot: replayProjectRoot,
        deploymentId: replayDeploymentId,
      });
  const { deployment } = replayComposition;
  const maxLossValue = (() => {
    if (replayFlags.maxLossValue == null || replayFlags.maxLossValue === '') {
      return null;
    }
    const value = Number(replayFlags.maxLossValue);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `Invalid --maxLossValue: ${String(replayFlags.maxLossValue)}`,
      );
    }
    return value;
  })();
  const sourceDeploymentCompositionId =
    replayComposition.strategies[0]?.deploymentCompositionId ??
    deployment.deploymentCompositionId;
  let replayStrategies = replayComposition.strategies.map((strategy) => {
    if (maxLossValue == null) return strategy;
    const strategyConfig = {
      ...strategy.strategyConfig,
      MAX_LOSS_VALUE: maxLossValue,
    } as typeof strategy.strategyConfig;
    return {
      ...strategy,
      strategyConfig,
      strategyRevision: computeStrategyRevision({
        strategyName: strategy.strategyName,
        strategyPackage: strategy.strategyPackage,
        strategyPackageVersion: strategy.strategyPackageVersion,
        strategyDependencyVersions: strategy.strategyDependencyVersions,
        runtimePackageVersion: strategy.runtimePackageVersion,
        strategyConfig,
      }),
    };
  });
  const researchDeploymentCompositionId = computeDeploymentCompositionId({
    deploymentId: deployment.id,
    connectorName: deployment.connectorName,
    provider: deployment.provider,
    accountId: deployment.accountId,
    enabled: deployment.enabled,
    ...(deployment.assetClasses
      ? { assetClasses: deployment.assetClasses }
      : {}),
    strategies: replayStrategies.map((strategy) => ({
      strategyName: strategy.strategyName,
      strategyRevision: strategy.strategyRevision,
      enabled: true,
      ...(strategy.selection ? { selection: strategy.selection } : {}),
    })),
  });
  replayStrategies = replayStrategies.map((strategy) => ({
    ...strategy,
    deploymentCompositionId: researchDeploymentCompositionId,
  }));
  if (!replayStrategies.length) {
    throw new Error(`No enabled strategies in deployment ${deployment.id}`);
  }
  const strategyIntervals = new Set(
    replayStrategies.map(({ strategyConfig }) =>
      String(strategyConfig.INTERVAL),
    ),
  );
  if (strategyIntervals.size !== 1 || !strategyIntervals.has(replayInterval)) {
    throw new Error(
      `Replay interval does not match deployment ${deployment.id}: replay=${replayInterval}, strategies=${[...strategyIntervals].join(',')}`,
    );
  }
  const strategyUniverses = new Set(
    replayStrategies.map(({ strategyConfig }) =>
      String(strategyConfig.UNIVERSE),
    ),
  );
  if (strategyUniverses.size !== 1) {
    throw new Error(
      `Replay requires one deployment universe: ${[...strategyUniverses].join(',')}`,
    );
  }
  const replaySelection = mergeRuntimeStrategySelections(replayStrategies);
  const useAllData =
    Boolean(replayFlags.allData) &&
    replayFlags.days == null &&
    replayFlags.startTime == null &&
    replayFlags.endTime == null;
  let candleCoverage:
    | {
        symbolsRequested: number;
        symbolsWithData: number;
        min: number;
        max: number;
      }
    | undefined;
  let portfolioMarketContextRows:
    | { tradeFlowRows: number; breadthRows: number }
    | undefined;
  let allDataTickers: string[] | undefined;
  if (useAllData && !replayFlags.tickers) {
    allDataTickers = await cachedTickerSymbols({
      connectorName: deployment.connectorName,
      universe: [...strategyUniverses][0],
      accountId: deployment.accountId,
    });
    if (!allDataTickers.length) {
      throw new Error(
        `No cached ticker universe found for ${deployment.connectorName}. Pass --tickers explicitly or refresh the ticker cache first.`,
      );
    }
  }
  const preparedRun = await prepareRunEnvironment({
    connector: deployment.connectorName,
    userName: replayUserName,
    tickers:
      replayFlags.tickers ??
      allDataTickers?.join(',') ??
      replaySelection?.tickers?.join(',') ??
      deployment.tickers?.join(','),
    exclude: replayFlags.exclude,
    tickersLimit: replayFlags.tickersLimit,
    showTickersList: replayFlags.showTickersList,
    days: replayFlags.days,
    startTime: replayFlags.startTime,
    endTime: replayFlags.endTime,
    cacheOnly: replayFlags.cacheOnly,
    interval: replayInterval,
    projectRoot: replayProjectRoot,
    universe: [...strategyUniverses][0] as 'crypto' | 'tradfi',
    accountId: deployment.accountId,
    deploymentId: deployment.id,
    assetClasses: deployment.assetClasses,
    deployment,
    closedIntervalMs: intervalToMs(replayInterval),
  });
  if (!preparedRun || isReplayUpdateOnlyRun) {
    return;
  }
  if (useAllData) {
    const intervalMs = intervalToMs(replayInterval);
    const edges = await getDataEdgesForSymbols(
      deployment.provider,
      preparedRun.tickers,
      Number(replayInterval),
    );
    const available = [...edges.values()].filter(
      (edge): edge is { min: number; max: number } =>
        Number.isFinite(edge.min) && Number.isFinite(edge.max),
    );
    if (!available.length) {
      throw new Error(
        `No cached candles found for provider=${deployment.provider}, interval=${replayInterval}`,
      );
    }
    const start = Math.min(...available.map((edge) => edge.min));
    const lastClosedEnd = Math.floor(Date.now() / intervalMs) * intervalMs - 1;
    const max = Math.min(
      Math.max(...available.map((edge) => edge.max)),
      lastClosedEnd,
    );
    preparedRun.window = {
      start,
      end: max + intervalMs - 1,
      source: 'explicit',
    };
    preparedRun.preloadStart = getBacktestPreloadStart(start);
    candleCoverage = {
      symbolsRequested: preparedRun.tickers.length,
      symbolsWithData: available.length,
      min: start,
      max,
    };
    console.log(
      chalk.gray(
        `cached candle coverage: ${new Date(start).toISOString()} -> ${new Date(max).toISOString()} (${available.length}/${preparedRun.tickers.length} symbols)`,
      ),
    );
  }
  setRuntimeCompareContext({
    connector: preparedRun.marketConnector,
    connectorName: preparedRun.connectorName,
    window: {
      start: preparedRun.window.start,
      end: preparedRun.window.end,
    },
  });

  const aiEnabled = replayStrategies.some(({ strategyConfig }) =>
    Boolean(strategyConfig.AI_ENABLED),
  );
  await prepareReplayBinanceMarketContext({
    ...preparedRun,
    aiEnabled,
    mlEnabled: replayStrategies.some(({ strategyConfig }) =>
      Boolean(strategyConfig.ML_ENABLED),
    ),
    strategyNames: replayStrategies.map(({ strategyName }) => strategyName),
  });
  if (replayFlags.portfolioReport && replayFlags.allData && aiEnabled) {
    portfolioMarketContextRows = await preloadBinanceMarketContextForWindow({
      startMs: preparedRun.window.start,
      endMs: preparedRun.window.end,
      interval: replayMarketContextInterval(),
    });
    console.log(
      chalk.gray(
        `preloaded Binance market context: ${portfolioMarketContextRows.tradeFlowRows} trade-flow rows, ${portfolioMarketContextRows.breadthRows} breadth rows`,
      ),
    );
  }

  console.log(chalk.yellow(`tickers: ${preparedRun.tickers.length}`));
  console.log(
    chalk.gray(
      `mode: replay (${replayStrategies
        .map(({ strategyName }) => strategyName)
        .join(', ')})`,
    ),
  );
  markTestsStarted();

  const portfolioBatchSize = Number(replayFlags.portfolioBatchSize ?? 4);
  if (
    replayFlags.portfolioReport &&
    (!Number.isSafeInteger(portfolioBatchSize) || portfolioBatchSize <= 0)
  ) {
    throw new Error(
      `Invalid --portfolioBatchSize: ${String(replayFlags.portfolioBatchSize)}`,
    );
  }
  const runtimeStrategies =
    replayFlags.tickers && !replayFlags.portfolioReport
      ? replayStrategies.map(
          ({ selection: _selection, ...strategy }) => strategy,
        )
      : replayStrategies;
  const historicalReplayReferences = replayFlags.portfolioReport
    ? await loadHistoricalReplayReferences({
        preparedRun,
        interval: replayInterval,
      })
    : undefined;
  const tickerBatches = replayFlags.portfolioReport
    ? Array.from(
        { length: Math.ceil(preparedRun.tickers.length / portfolioBatchSize) },
        (_, index) =>
          preparedRun.tickers.slice(
            index * portfolioBatchSize,
            (index + 1) * portfolioBatchSize,
          ),
      )
    : [preparedRun.tickers];
  const runReplayBatch = async (batchTickers: string[]) => {
    const result = await runHistoricalSignalsReplay({
      preparedRun: { ...preparedRun, tickers: batchTickers },
      interval: replayInterval,
      runtimeStrategies,
      references: historicalReplayReferences,
      showProgress: !replayFlags.portfolioReport,
      collectSkipEvidence: !replayFlags.portfolioReport,
      collectSignals: !replayFlags.portfolioReport,
    });
    return replayFlags.portfolioReport
      ? compactHistoricalReplayResultForPortfolio(result)
      : result;
  };
  const batchResults: HistoricalSignalsReplayResult[] = [];
  for (const [index, batchTickers] of tickerBatches.entries()) {
    if (tickerBatches.length > 1) {
      console.log(
        chalk.gray(
          `portfolio batch ${index + 1}/${tickerBatches.length}: ${batchTickers.length} symbols`,
        ),
      );
    }
    batchResults.push(await runReplayBatch(batchTickers));
    if (replayFlags.portfolioReport) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      (
        globalThis as typeof globalThis & {
          gc?: () => void;
        }
      ).gc?.();
    }
  }
  const replayResult =
    batchResults.length === 1
      ? batchResults[0]
      : mergeHistoricalReplayResults(batchResults);

  for (const _strategy of replayResult.strategies) {
    incrementSuccessTests();
  }

  await finishReplay({
    replayResult,
    tickers: preparedRun.tickers,
    connectorName: preparedRun.connectorName,
    window: preparedRun.window,
    portfolioLineage: replayFlags.portfolioReport
      ? {
          sourceDeploymentId: deployment.id,
          sourceDeploymentCompositionId,
          researchDeploymentCompositionId,
          maxLossValue,
          aiMode: 'strategy runtime declaration',
          cacheOnly: Boolean(replayFlags.cacheOnly),
          portfolioSemantics:
            'production strategy order and one concurrent position per symbol; fixed-risk symbol batches are merged by canonical realized PnL',
          portfolioBatchSize,
          tickers: preparedRun.tickers,
          candleCoverage: candleCoverage ?? null,
          binanceMarketContextRows: portfolioMarketContextRows ?? null,
          strategies: replayStrategies.map((strategy) => ({
            strategyName: strategy.strategyName,
            strategyRevision: strategy.strategyRevision,
            strategyPackage: strategy.strategyPackage,
            strategyPackageVersion: strategy.strategyPackageVersion,
            aiEnabled: Boolean(strategy.strategyConfig.AI_ENABLED),
            minAiQuality: strategy.strategyConfig.MIN_AI_QUALITY ?? null,
            aiMode: strategy.strategyConfig.AI_MODE ?? null,
            maxLossValue: strategy.strategyConfig.MAX_LOSS_VALUE ?? null,
            selection: strategy.selection ?? null,
            effectiveConfig: strategy.strategyConfig,
          })),
        }
      : undefined,
  });
};
