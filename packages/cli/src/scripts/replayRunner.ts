import chalk from 'chalk';
import { TTL_1M } from '@tradejs/core/constants';
import { intervalToMs } from '@tradejs/core/data';
import { formatUnix } from '@tradejs/core/time';
import { setData, redisKeys } from '@tradejs/infra/redis';
import { createTimestamp } from '../lib/runFormatting';
import {
  loadReplayStrategies,
  prepareRunEnvironment,
} from '../lib/runEnvironment';
import {
  buildReplayExchangeComparisonDetails,
  buildReplayRuntimeComparisonDetails,
  resolveReplayStrategyNameFromExchangeEntry,
} from '../lib/runtimeParityDetails';
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
  replayFlags,
  replayInterval,
  replayProjectRoot,
  replayRuntimeEvidencePath,
  replayUserName,
} from '../lib/replay/cliConfig';
import { REPLAY_RESULTS_CONFIG } from '../lib/replay/support';
import {
  HistoricalSignalsReplayResult,
  runHistoricalSignalsReplay,
} from '../lib/replay/historicalSignalsReplay';
import { buildReplayChartSnapshot } from '../lib/replay/chartSnapshot';
import { saveAndPrintReplayResultsByStrategy } from '../lib/replay/resultsReporting';
import { saveAndPrintReplayRuntimeComparison } from '../lib/replay/runtimeComparison';
import { writeReplayOutputReport } from '../lib/replay/outputReport';

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

const finishReplay = async ({
  replayResult,
  tickers,
  connectorName,
  window,
}: {
  replayResult: HistoricalSignalsReplayResult;
  tickers: string[];
  connectorName: string;
  window: { start: number; end: number };
}) => {
  const replayStrategySnapshot = await saveAndPrintReplayResultsByStrategy({
    replayResult,
    tickers,
  });
  const replayRuntimeComparison = await saveAndPrintReplayRuntimeComparison({
    liveStrategySummaries: replayStrategySnapshot.summaries,
    backtestEntries: replayStrategySnapshot.backtestEntries,
    replaySignals: replayResult.signals,
    replayLineages: replayResult.runtimeLineages,
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
  const preparedRun = await prepareRunEnvironment({
    connector: replayFlags.connector,
    userName: replayUserName,
    tickers: replayFlags.tickers,
    exclude: replayFlags.exclude,
    tickersLimit: replayFlags.tickersLimit,
    showTickersList: replayFlags.showTickersList,
    days: replayFlags.days,
    startTime: replayFlags.startTime,
    endTime: replayFlags.endTime,
    cacheOnly: replayFlags.cacheOnly,
    interval: replayInterval,
    projectRoot: replayProjectRoot,
    closedIntervalMs: intervalToMs(replayInterval),
  });
  if (!preparedRun || isReplayUpdateOnlyRun) {
    return;
  }
  setRuntimeCompareContext({
    connector: preparedRun.marketConnector,
    connectorName: preparedRun.connectorName,
    window: {
      start: preparedRun.window.start,
      end: preparedRun.window.end,
    },
  });

  const replayStrategies = await loadReplayStrategies(replayUserName);
  if (!replayStrategies.length) {
    return;
  }
  await prepareReplayBinanceMarketContext({
    ...preparedRun,
    aiEnabled: replayStrategies.some(({ strategyConfig }) =>
      Boolean(strategyConfig.AI_ENABLED),
    ),
    mlEnabled: replayStrategies.some(({ strategyConfig }) =>
      Boolean(strategyConfig.ML_ENABLED),
    ),
    strategyNames: replayStrategies.map(({ strategyName }) => strategyName),
  });

  console.log(chalk.yellow(`tickers: ${preparedRun.tickers.length}`));
  console.log(
    chalk.gray(
      `mode: replay (${replayStrategies
        .map(({ strategyName }) => strategyName)
        .join(', ')})`,
    ),
  );
  markTestsStarted();

  const replayResult = await runHistoricalSignalsReplay({
    preparedRun,
    interval: replayInterval,
    runtimeStrategies: replayStrategies,
  });

  for (const _strategy of replayResult.strategies) {
    incrementSuccessTests();
  }

  await finishReplay({
    replayResult,
    tickers: preparedRun.tickers,
    connectorName: preparedRun.connectorName,
    window: preparedRun.window,
  });
};
