import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import args from 'args';
import chalk from 'chalk';
import { BACKTEST_PRELOAD_DAYS } from '@tradejs/core/constants';
import { formatUnix, getBacktestPreloadStart } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import { getData, redisKeys } from '@tradejs/infra/redis';
import { getTickers } from '@tradejs/node/cli';
import {
  releaseTestingSymbolCache,
  resetTestingKlineCache,
  testing,
} from '@tradejs/node/backtest';
import {
  DEFAULT_CONNECTOR_NAME,
  getConnectorCreatorByName,
  resolveConnectorName,
} from '@tradejs/node/connectors';
import {
  ConnectorCreator,
  Interval,
  RuntimeTradeRecord,
  RuntimeSignalEvaluationRecord,
  RuntimeAiAnalysisSnapshot,
  StrategyConfig,
  StrategyResults,
} from '@tradejs/types';
import {
  extractBacktestEntryParityEntries,
  TradeParityEntry,
} from '../lib/runtimeParity';
import { normalizeCliArgv } from '../lib/cliArgs';
import { loadRuntimeTrades } from '../lib/runtimeRedis';
import {
  loadRuntimeSignalEvaluations,
  loadRuntimeSignals,
} from '../lib/runtimeSignalsLoader';
import { sendTelegramReport } from '../lib/telegramReports';
import { resolveTimeWindow } from '../lib/timeWindow';
import { formatDuration } from '../lib/runFormatting';
import { prepareMarketContextForRun } from '../lib/marketContextPrepare';
import {
  loadBtcReferenceConnectors,
  updateMarketHistoryWithBtcReferences,
} from '../lib/marketData/historyPrepare';
import {
  buildReplayInputsIndex,
  buildReplayTargets,
  countReplayTargetSources,
  parseSymbolsFromCLI,
  toTargetKey,
  type ReplayError,
  type ReplayInputsIndex,
  type ReplayTarget,
} from '../lib/runtimeParity/targets';
import { loadRuntimeParityEvidence } from '../lib/runtimeParity/evidence';
import { analyzeRuntimeParity } from '../lib/runtimeParity/analysis';
import {
  buildRuntimeParityMessage,
  buildRuntimeParityMismatchAttachment,
  buildRuntimeParityNoTargetsMessage,
  buildRuntimeParityTerminalReport,
  printClassifiedBacktestOnlyDetails,
  printClassifiedRuntimeOnlyDetails,
  printRuntimeDuplicateDetails,
  writeRuntimeParityTerminalReport,
} from '../lib/runtimeParity/reporting';

export { buildRuntimeParityMessage } from '../lib/runtimeParity/reporting';
import {
  buildRuntimeModeStrategyConfig,
  hasRuntimeEntryGateEnabled,
  resolveReplayStrategyEnv,
} from '../lib/runtimeModeConfig';

args.option(['u', 'user'], 'Use user config', 'root');
args.option(
  ['o', 'connector'],
  'Connector provider or name for parity replay (e.g. bybit, binance, coinbase, custom)',
  'bybit',
);
args.option(['d', 'days'], 'Replay window in days', 3);
args.option(
  ['b', 'startTime'],
  'Explicit replay start timestamp (ms or seconds)',
);
args.option(['e', 'endTime'], 'Explicit replay end timestamp (ms or seconds)');
args.option(['s', 'strategy'], 'Only compare one strategy');
args.option(
  ['t', 'tickers'],
  'Replay comma-separated symbols for all configured strategies',
);
args.option(
  ['C', 'cacheOnly'],
  'Do not refresh market history before replay',
  false,
);
args.option(
  ['a', 'toleranceBars'],
  'Allowed entry timestamp drift in bars when matching runtime vs backtest',
  1,
);
args.option(
  'fullUniverse',
  'Replay every configured strategy across the full connector universe. By default parity replays only runtime-traded and strategy-results symbols unless --tickers is provided.',
  false,
);
args.option(
  'runtimeGates',
  'Force runtime AI/ML gates for all replay targets. Runtime-gated configs are replayed with gates by default.',
  false,
);
args.option(['N', 'notify'], 'Send parity summary to Telegram', false);
args.option(['D', 'details'], 'Print unmatched entry details (capped)', false);

process.argv = normalizeCliArgv(process.argv, {
  '-C': '--cacheOnly',
  '-D': '--details',
  '-E': '--endTime',
  '-N': '--notify',
  '-S': '--startTime',
  '-T': '--toleranceBars',
});

const flags = args.parse(process.argv);
const interval = '15' as Interval;
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
const DEFAULT_LOOKBACK_DAYS = 3;
const DETAIL_LIMIT = 10;
const DEFAULT_REPLAY_ENV = flags.runtimeGates ? 'PARITY' : 'BACKTEST';

const resolveParityConnectorName = async (value: unknown): Promise<string> => {
  const connectorName = await resolveConnectorName(value, projectRoot);
  if (connectorName) {
    return connectorName;
  }

  logger.warn(
    'Unknown connector "%s". Fallback to %s.',
    String(value || '').trim() || String(value),
    DEFAULT_CONNECTOR_NAME,
  );
  return DEFAULT_CONNECTOR_NAME;
};

const createConnector = async ({
  userName,
  connectorName,
}: {
  userName: string;
  connectorName: string;
}) => {
  const connectorFactory = await getConnectorCreatorByName(
    connectorName,
    projectRoot,
  );
  if (!connectorFactory) {
    throw new Error(`Connector "${connectorName}" is not registered`);
  }

  return await (connectorFactory as ConnectorCreator)({ userName });
};

const buildReplayAiAnalyses = ({
  runtimeTrades,
  runtimeSignalEvaluations,
  toleranceMs,
}: Pick<ReplayTarget, 'strategy' | 'symbol'> & {
  runtimeTrades: RuntimeTradeRecord[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  toleranceMs: number;
}): RuntimeAiAnalysisSnapshot[] => {
  const snapshots = [
    ...runtimeTrades
      .filter(
        (trade) =>
          trade.aiAnalysis &&
          typeof trade.entryTimestamp === 'number' &&
          Number.isFinite(trade.entryTimestamp),
      )
      .map((trade) => ({
        strategy: trade.strategy,
        symbol: trade.symbol,
        direction: trade.direction,
        timestamp: trade.entryTimestamp,
        toleranceMs,
        analysis: trade.aiAnalysis!,
      })),
    ...runtimeSignalEvaluations
      .filter(
        (evaluation) =>
          evaluation.aiAnalysis &&
          evaluation.direction &&
          typeof evaluation.timestamp === 'number' &&
          Number.isFinite(evaluation.timestamp),
      )
      .map((evaluation) => ({
        strategy: evaluation.strategy,
        symbol: evaluation.symbol,
        direction: evaluation.direction!,
        timestamp: evaluation.timestamp,
        toleranceMs,
        analysis: evaluation.aiAnalysis!,
      })),
  ];

  const seen = new Set<string>();
  return snapshots.filter((snapshot) => {
    const key = `${snapshot.strategy}:${snapshot.symbol}:${snapshot.direction}:${snapshot.timestamp}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const formatReplayEnvSummary = (configs: Iterable<StrategyConfig>) => {
  let backtest = 0;
  let parity = 0;

  for (const config of configs) {
    if (config.ENV === 'PARITY') {
      parity += 1;
    } else {
      backtest += 1;
    }
  }

  if (parity > 0 && backtest > 0) {
    return `MIXED (PARITY=${parity}, BACKTEST=${backtest})`;
  }
  if (parity > 0) {
    return 'PARITY';
  }
  return 'BACKTEST';
};

const buildReplayConfig = async ({
  userName,
  strategy,
  symbol,
  replayInputsIndex,
  toleranceMs,
}: Pick<ReplayTarget, 'strategy' | 'symbol'> & {
  userName: string;
  replayInputsIndex: ReplayInputsIndex;
  toleranceMs: number;
}): Promise<StrategyConfig> => {
  const [userConfig, strategyResults] = await Promise.all([
    getData(redisKeys.strategyConfig(userName, strategy), {}),
    getData(redisKeys.strategyResults(userName, strategy), {}),
  ]);

  const typedResults = (strategyResults ?? {}) as StrategyResults;
  const symbolResult = typedResults?.[symbol];
  const symbolConfig =
    symbolResult &&
    symbolResult.config &&
    typeof symbolResult.config === 'object'
      ? symbolResult.config
      : {};
  const replayInputs = replayInputsIndex.get(toTargetKey({ strategy, symbol }));
  const aiReplayAnalyses = buildReplayAiAnalyses({
    runtimeTrades: replayInputs?.runtimeTrades ?? [],
    runtimeSignalEvaluations: replayInputs?.runtimeSignalEvaluations ?? [],
    strategy,
    symbol,
    toleranceMs,
  });
  const strategyConfig = {
    ...(userConfig as StrategyConfig),
    ...(symbolConfig as StrategyConfig),
  };

  return buildRuntimeModeStrategyConfig({
    strategyConfig,
    env: resolveReplayStrategyEnv({
      strategyConfig,
      forceRuntimeGates: Boolean(flags.runtimeGates),
    }),
    interval,
    makeOrders: true,
    recordRuntimeTrades: false,
    aiReplayAnalyses,
  });
};

const warmReplayHistory = async ({
  userName,
  connectorName,
  targets,
  preloadStart,
  preloadEnd,
}: {
  userName: string;
  connectorName: string;
  targets: ReplayTarget[];
  preloadStart: number;
  preloadEnd: number;
}) => {
  const connector = await createConnector({ userName, connectorName });
  const symbols = [...new Set(targets.map((target) => target.symbol))];
  const warmStartedAt = Date.now();

  console.log(
    chalk.gray(
      `Warm history: ${symbols.length} symbol(s) on ${connectorName}, preload ${formatUnix(preloadStart)} -> ${formatUnix(preloadEnd)}`,
    ),
  );

  const btcReferences = await loadBtcReferenceConnectors({
    connectorName,
    marketConnector: connector,
    userName,
    projectRoot,
    shouldUseDedicatedReferences: true,
    warn: (message) => logger.warn(message),
  });
  await updateMarketHistoryWithBtcReferences({
    marketConnector: connector,
    connectorName,
    btcReferences,
    interval,
    symbols,
    preloadStart,
    preloadEnd,
    log: (message) => console.log(chalk.gray(message)),
  });

  console.log(
    chalk.gray(`Warm history: done in ${formatDuration(warmStartedAt)}`),
  );
};

export const runtimeParity = async () => {
  const window = resolveTimeWindow({
    days: flags.days ?? DEFAULT_LOOKBACK_DAYS,
    startTime: flags.startTime,
    endTime: flags.endTime,
    defaultStartMs: Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    defaultEndMs: Date.now(),
  });
  const toleranceBars = Math.max(
    0,
    Number.parseInt(String(flags.toleranceBars ?? 1), 10) || 0,
  );
  const toleranceMs = toleranceBars * 15 * 60 * 1000;
  const connectorName = await resolveParityConnectorName(flags.connector);
  const requestedSymbols = parseSymbolsFromCLI(String(flags.tickers || ''));
  const requestedSymbolSet = requestedSymbols.length
    ? new Set(requestedSymbols)
    : null;

  let replayErrors: ReplayError[] = [];

  try {
    const parityConnector = await createConnector({
      userName: flags.user,
      connectorName,
    });
    const { runtimeTrades, runtimeSignals, runtimeSignalEvaluations } =
      await loadRuntimeParityEvidence(
        {
          userName: flags.user,
          window,
          strategy: flags.strategy,
          symbols: requestedSymbolSet,
        },
        {
          loadRuntimeTrades,
          loadRuntimeSignals,
          loadRuntimeSignalEvaluations,
        },
      );
    const connectorSymbols = requestedSymbols.length
      ? requestedSymbols
      : await getTickers(parityConnector);
    const replayInputsIndex = buildReplayInputsIndex({
      runtimeTrades,
      runtimeSignalEvaluations,
    });

    const replayTargets = await buildReplayTargets({
      userName: flags.user,
      runtimeTrades,
      connectorSymbols,
      strategyFilter: String(flags.strategy || '').trim() || undefined,
      explicitSymbols: requestedSymbols,
      includeConnectorUniverse: Boolean(flags.fullUniverse),
    });

    if (!replayTargets.length) {
      console.log(
        chalk.yellow(
          `No replay targets found for ${flags.user} in ${formatUnix(window.start)} -> ${formatUnix(window.end)}.`,
        ),
      );
      if (flags.notify) {
        await sendTelegramReport(
          buildRuntimeParityNoTargetsMessage({
            window,
            connectorName,
            replayEnv: DEFAULT_REPLAY_ENV,
            runtimeGatesEnabled: Boolean(flags.runtimeGates),
            userName: String(flags.user),
          }),
          { userName: flags.user },
        );
      }
      return;
    }

    const sourceCounts = countReplayTargetSources(replayTargets);
    const preloadStart = getBacktestPreloadStart(
      window.start,
      BACKTEST_PRELOAD_DAYS,
    );
    const replayStartedAt = Date.now();
    const replaySymbolsCount = new Set(
      replayTargets.map((target) => target.symbol),
    ).size;

    console.log(
      chalk.gray(
        `Replay queue: ${replayTargets.length} target(s), ${replaySymbolsCount} symbol(s), mode=${flags.fullUniverse ? 'full-universe' : requestedSymbols.length ? 'explicit-tickers' : 'runtime+results'}`,
      ),
    );

    const replayConfigs = new Map<string, StrategyConfig>();
    for (const target of replayTargets) {
      const replayConfig = await buildReplayConfig({
        userName: flags.user,
        strategy: target.strategy,
        symbol: target.symbol,
        replayInputsIndex,
        toleranceMs,
      });
      replayConfigs.set(toTargetKey(target), replayConfig);
    }
    const replayEnvSummary = formatReplayEnvSummary(replayConfigs.values());
    const hasParityAiTargets = [...replayConfigs.values()].some(
      (config) => config.ENV === 'PARITY' && config.AI_ENABLED === true,
    );
    const hasParityMlTargets = [...replayConfigs.values()].some(
      (config) => config.ENV === 'PARITY' && config.ML_ENABLED === true,
    );

    await prepareMarketContextForRun({
      mode: 'parity',
      userName: flags.user,
      projectRoot,
      symbols: replayTargets.map((target) => target.symbol),
      interval,
      startMs: window.start,
      endMs: window.end,
      preloadStartMs: preloadStart,
      cacheOnly: Boolean(flags.cacheOnly),
      aiEnabled: hasParityAiTargets,
      mlEnabled: hasParityMlTargets,
      strategyNames: replayTargets.map((target) => target.strategy),
      log: (message) => console.log(chalk.gray(message)),
    });

    if (!flags.cacheOnly) {
      await warmReplayHistory({
        userName: flags.user,
        connectorName,
        targets: replayTargets,
        preloadStart,
        preloadEnd: window.end,
      });
    }

    const backtestEntries: TradeParityEntry[] = [];
    const replaySignalEvaluations: RuntimeSignalEvaluationRecord[] = [];
    const successfulTargetKeys = new Set<string>();
    const runtimeGateWarningCounts = new Map<string, number>();

    for (const [targetIndex, target] of replayTargets.entries()) {
      const progressPosition = targetIndex + 1;
      try {
        const replayConfig = replayConfigs.get(toTargetKey(target));
        if (!replayConfig) {
          throw new Error(
            `Replay config not prepared for ${toTargetKey(target)}`,
          );
        }

        if (
          replayConfig.ENV !== 'PARITY' &&
          hasRuntimeEntryGateEnabled(replayConfig)
        ) {
          runtimeGateWarningCounts.set(
            target.strategy,
            (runtimeGateWarningCounts.get(target.strategy) ?? 0) + 1,
          );
        }

        const result = await testing({
          userName: flags.user,
          symbol: target.symbol,
          options: {
            start: window.start,
            end: window.end,
          },
          name: `${target.symbol}_${target.strategy}_${randomUUID().slice(0, 8)}`,
          testId: randomUUID().slice(0, 8),
          testSuiteId: randomUUID().slice(0, 8),
          strategyName: target.strategy,
          strategyConfig: replayConfig,
          connectorName,
          collectReplaySignalEvaluations: true,
          timeoutMs: 120_000,
        });

        backtestEntries.push(
          ...extractBacktestEntryParityEntries(result?.inlineOrderLog),
        );
        replaySignalEvaluations.push(
          ...(result?.inlineReplaySignalEvaluations ?? []),
        );
        successfulTargetKeys.add(toTargetKey(target));
      } catch (error) {
        replayErrors.push({
          ...target,
          message: (error as Error)?.message || String(error),
        });
      } finally {
        releaseTestingSymbolCache({
          cwd: projectRoot,
          userName: flags.user,
          connectorName,
          symbol: target.symbol,
        });
      }

      if (
        progressPosition === 1 ||
        progressPosition === replayTargets.length ||
        progressPosition % 25 === 0
      ) {
        console.log(
          chalk.gray(
            `Replay progress: ${progressPosition}/${replayTargets.length}, ok=${successfulTargetKeys.size}, errors=${replayErrors.length}, current=${target.strategy} ${target.symbol}, elapsed=${formatDuration(replayStartedAt)}`,
          ),
        );
      }
    }

    const {
      rawRuntimeEntries,
      runtimeDedupe,
      runtimeEntries,
      comparison,
      classifiedBacktestOnly,
      classifiedRuntimeOnly,
      matchedSummary: summary,
      strategyRows,
    } = analyzeRuntimeParity({
      runtimeTrades,
      runtimeSignals,
      runtimeSignalEvaluations,
      backtestEntries,
      replaySignalEvaluations,
      replayTargets,
      successfulTargetKeys,
      replayErrors,
      toleranceMs,
    });

    writeRuntimeParityTerminalReport(
      buildRuntimeParityTerminalReport({
        window,
        connectorName,
        replayEnv: replayEnvSummary,
        runtimeGatesEnabled:
          Boolean(flags.runtimeGates) || replayEnvSummary.includes('PARITY'),
        runtimeGatesRequested: Boolean(flags.runtimeGates),
        toleranceBars,
        toleranceMs,
        replayTargetsCount: replayTargets.length,
        comparedTargetsCount: successfulTargetKeys.size,
        replayErrors,
        sourceCounts,
        rawRuntimeEntriesCount: rawRuntimeEntries.length,
        runtimeEntriesCount: runtimeEntries.length,
        runtimeDuplicateGroupsCount: runtimeDedupe.duplicateGroups.length,
        runtimeDuplicateEntriesCount: runtimeDedupe.duplicateEntries.length,
        backtestEntriesCount: backtestEntries.length,
        runtimeOnlyCount: comparison.runtimeOnly.length,
        backtestOnlyCount: comparison.backtestOnly.length,
        matchedSummary: summary,
        classifiedRuntimeOnly,
        classifiedBacktestOnly,
        runtimeSignalEvaluationsCount: runtimeSignalEvaluations.length,
        strategyRows,
        runtimeGateWarningCounts,
        detailLimit: DETAIL_LIMIT,
      }),
    );

    if (flags.details) {
      printRuntimeDuplicateDetails(runtimeDedupe.duplicateGroups);
      printClassifiedRuntimeOnlyDetails(classifiedRuntimeOnly);
      printClassifiedBacktestOnlyDetails(classifiedBacktestOnly);
    }

    if (flags.notify) {
      const mismatchAttachment = buildRuntimeParityMismatchAttachment({
        window,
        connectorName,
        replayEnv: replayEnvSummary,
        toleranceBars,
        toleranceMs,
        replayTargetsCount: replayTargets.length,
        comparedTargetsCount: successfulTargetKeys.size,
        replayErrors,
        sourceCounts,
        rawRuntimeEntriesCount: rawRuntimeEntries.length,
        runtimeEntriesCount: runtimeEntries.length,
        runtimeDuplicateEntriesCount: runtimeDedupe.duplicateEntries.length,
        backtestEntriesCount: backtestEntries.length,
        matchedCount: comparison.matched.length,
        runtimeOnlyCount: comparison.runtimeOnly.length,
        backtestOnlyCount: comparison.backtestOnly.length,
        matchedSummary: summary,
        classifiedRuntimeOnly,
        classifiedBacktestOnly,
        runtimeSignalEvaluationsCount: runtimeSignalEvaluations.length,
        strategyRows,
      });
      await sendTelegramReport(
        buildRuntimeParityMessage({
          window,
          connectorName,
          replayEnv: replayEnvSummary,
          runtimeGatesEnabled:
            Boolean(flags.runtimeGates) || replayEnvSummary.includes('PARITY'),
          toleranceBars,
          toleranceMs,
          replayTargetsCount: replayTargets.length,
          comparedTargetsCount: successfulTargetKeys.size,
          replayErrors,
          sourceCounts,
          rawRuntimeEntriesCount: rawRuntimeEntries.length,
          runtimeEntriesCount: runtimeEntries.length,
          runtimeDuplicateEntriesCount: runtimeDedupe.duplicateEntries.length,
          backtestEntriesCount: backtestEntries.length,
          matchedCount: comparison.matched.length,
          runtimeOnlyCount: comparison.runtimeOnly.length,
          backtestOnlyCount: comparison.backtestOnly.length,
          matchedSummary: summary,
          classifiedRuntimeOnly,
          classifiedBacktestOnly,
          runtimeSignalEvaluationsCount: runtimeSignalEvaluations.length,
          strategyRows,
          runtimeGateWarningCounts,
        }),
        {
          userName: flags.user,
          attachments: mismatchAttachment ? [mismatchAttachment] : undefined,
        },
      );
    }
  } finally {
    resetTestingKlineCache(projectRoot);
  }
};
export const main = runtimeParity;
