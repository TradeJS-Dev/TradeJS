import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import args from 'args';
import chalk from 'chalk';
import { ConnectorNames } from '@tradejs/connectors';
import { BACKTEST_PRELOAD_DAYS } from '@tradejs/core/constants';
import { formatUnix, getBacktestPreloadStart } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import { getData, getKeys, redisKeys } from '@tradejs/infra/redis';
import { getTickers, update } from '@tradejs/node/cli';
import { resetTestingKlineCache, testing } from '@tradejs/node/backtest';
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
  Signal,
  SignalOrderStatus,
  StrategyConfig,
  StrategyResults,
} from '@tradejs/types';
import {
  compareTradeParityEntries,
  dedupeRuntimeParityEntries,
  extractBacktestEntryParityEntries,
  extractRuntimeParityEntries,
  RuntimeDuplicateGroup,
  summarizeMatchedParity,
  TradeParityEntry,
} from '../lib/runtimeParity';
import { normalizeCliArgv } from '../lib/cliArgs';
import {
  loadRuntimeSignalEvaluations,
  loadRuntimeSignals,
} from '../lib/runtimeSignalsLoader';
import { sendTelegramReport } from '../lib/telegramReports';
import { resolveTimeWindow } from '../lib/timeWindow';

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
  'Replay with runtime AI/ML gates enabled when configured. This may call external AI providers and ML inference.',
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
const TELEGRAM_DETAIL_LIMIT = 5;
const SUMMARY_TIMEZONE = 'Europe/Moscow';
const SUMMARY_TIMEZONE_LABEL = 'MSK';
const REPLAY_ENV = flags.runtimeGates ? 'PARITY' : 'BACKTEST';

type ReplayTarget = {
  strategy: string;
  symbol: string;
  sources: Array<
    'runtime' | 'strategyResults' | 'connectorUniverse' | 'explicitTickers'
  >;
};

type ReplayError = ReplayTarget & {
  message: string;
};

type ReplayTargetSourceCounts = {
  runtime: number;
  connectorUniverse: number;
  explicitTickers: number;
  strategyResults: number;
};

const formatDuration = (startedAt: number) => {
  const seconds = Math.max(0, (Date.now() - startedAt) / 1000);
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}m ${restSeconds}s`;
};

type BacktestOnlyClassification =
  | 'gated_out'
  | 'order_failed'
  | 'core_skipped'
  | 'not_evaluated'
  | 'true_mismatch';

type ClassifiedBacktestOnlyEntry = {
  entry: TradeParityEntry;
  classification: BacktestOnlyClassification;
  reason: string;
  signal?: Signal;
  signalTimestampDiffMs?: number;
  evaluation?: RuntimeSignalEvaluationRecord;
  evaluationTimestampDiffMs?: number;
};

type RuntimeOnlyClassification =
  | 'gated_out'
  | 'order_failed'
  | 'core_skipped'
  | 'backtest_drift'
  | 'not_evaluated'
  | 'true_mismatch';

type ClassifiedRuntimeOnlyEntry = {
  entry: TradeParityEntry;
  classification: RuntimeOnlyClassification;
  reason: string;
  evaluation?: RuntimeSignalEvaluationRecord;
  evaluationTimestampDiffMs?: number;
  nearestBacktestEntry?: TradeParityEntry;
  nearestBacktestEntryTimestampDiffMs?: number;
};

type StrategyParitySummaryRow = {
  runtime: number;
  runtimeDuplicates: number;
  backtest: number;
  matched: number;
  runtimeOnly: number;
  backtestOnly: number;
  targets: number;
  compared: number;
  errors: number;
};

const BACKTEST_ONLY_CLASSIFICATIONS: BacktestOnlyClassification[] = [
  'gated_out',
  'order_failed',
  'core_skipped',
  'not_evaluated',
  'true_mismatch',
];

const RUNTIME_ONLY_CLASSIFICATIONS: RuntimeOnlyClassification[] = [
  'gated_out',
  'order_failed',
  'core_skipped',
  'backtest_drift',
  'not_evaluated',
  'true_mismatch',
];

const parseSymbolsFromCLI = (symbols = '') =>
  symbols
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .map((symbol) => (symbol.endsWith('USDT') ? symbol : `${symbol}USDT`));

const toTargetKey = (target: Pick<ReplayTarget, 'strategy' | 'symbol'>) =>
  `${target.strategy}::${target.symbol}`;

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatMskDateTime = (timestamp: number) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: SUMMARY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));

const normalizeSignalOrderStatus = (
  value: Signal['orderStatus'],
): SignalOrderStatus | 'unknown' => {
  if (
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped' ||
    value === 'canceled'
  ) {
    return value;
  }

  return 'unknown';
};

const isRuntimeTradeRecord = (value: unknown): value is RuntimeTradeRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.orderId === 'string' &&
    typeof record.strategy === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.entryTimestamp === 'number' &&
    typeof record.entryPrice === 'number' &&
    typeof record.qty === 'number' &&
    (record.direction === 'LONG' || record.direction === 'SHORT')
  );
};

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

const loadRuntimeTrades = async (
  userName: string,
): Promise<RuntimeTradeRecord[]> => {
  const keys = await getKeys(redisKeys.runtimeTrades(userName));
  const trades = await Promise.all(keys.map((key) => getData(key, null)));

  return trades
    .filter(isRuntimeTradeRecord)
    .sort((left, right) => left.entryTimestamp - right.entryTimestamp);
};

const resolveStrategyNameByConfigKey = (
  userName: string,
  key: string,
): string | null => {
  const parts = key.split(':');
  if (parts.length !== 5) {
    return null;
  }

  const [users, keyUserName, strategiesKey, strategyName, configKey] = parts;
  if (
    users !== 'users' ||
    keyUserName !== userName ||
    strategiesKey !== 'strategies' ||
    configKey !== 'config' ||
    !strategyName
  ) {
    return null;
  }

  return strategyName;
};

const loadConfiguredStrategyNames = async (userName: string) => {
  const keys = await getKeys(`${redisKeys.strategies(userName)}:`);

  return keys
    .filter((key) => key.endsWith(':config'))
    .map((key) => resolveStrategyNameByConfigKey(userName, key))
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));
};

const loadStrategyResultSymbols = async ({
  userName,
  strategy,
}: {
  userName: string;
  strategy: string;
}) => {
  const results = (await getData(
    redisKeys.strategyResults(userName, strategy),
    {},
  )) as StrategyResults;

  return Object.keys(results ?? {}).sort((left, right) =>
    left.localeCompare(right),
  );
};

const addReplayTarget = (
  targets: Map<string, ReplayTarget>,
  target: Pick<ReplayTarget, 'strategy' | 'symbol'>,
  source: ReplayTarget['sources'][number],
) => {
  const key = toTargetKey(target);
  const existing = targets.get(key);

  if (existing) {
    if (!existing.sources.includes(source)) {
      existing.sources.push(source);
    }
    return;
  }

  targets.set(key, {
    strategy: target.strategy,
    symbol: target.symbol,
    sources: [source],
  });
};

const countReplayTargetSources = (
  targets: ReplayTarget[],
): ReplayTargetSourceCounts => ({
  runtime: targets.filter((target) => target.sources.includes('runtime'))
    .length,
  connectorUniverse: targets.filter((target) =>
    target.sources.includes('connectorUniverse'),
  ).length,
  explicitTickers: targets.filter((target) =>
    target.sources.includes('explicitTickers'),
  ).length,
  strategyResults: targets.filter((target) =>
    target.sources.includes('strategyResults'),
  ).length,
});

const buildReplayTargets = async ({
  userName,
  runtimeTrades,
  connectorSymbols,
  strategyFilter,
  explicitSymbols,
  includeConnectorUniverse,
}: {
  userName: string;
  runtimeTrades: RuntimeTradeRecord[];
  connectorSymbols: string[];
  strategyFilter?: string;
  explicitSymbols: string[];
  includeConnectorUniverse: boolean;
}) => {
  const targets = new Map<string, ReplayTarget>();
  let configuredStrategies = (
    await loadConfiguredStrategyNames(userName)
  ).filter((strategy) => !strategyFilter || strategy === strategyFilter);
  if (
    strategyFilter &&
    !configuredStrategies.some((strategy) => strategy === strategyFilter)
  ) {
    configuredStrategies = [strategyFilter];
  }
  const explicitSymbolSet = explicitSymbols.length
    ? new Set(explicitSymbols)
    : null;

  for (const trade of runtimeTrades) {
    if (strategyFilter && trade.strategy !== strategyFilter) {
      continue;
    }
    if (explicitSymbolSet && !explicitSymbolSet.has(trade.symbol)) {
      continue;
    }
    addReplayTarget(
      targets,
      { strategy: trade.strategy, symbol: trade.symbol },
      'runtime',
    );
  }

  if (explicitSymbols.length || includeConnectorUniverse) {
    const universeSymbols = explicitSymbols.length
      ? explicitSymbols
      : connectorSymbols;
    const universeSource = explicitSymbols.length
      ? 'explicitTickers'
      : 'connectorUniverse';

    for (const strategy of configuredStrategies) {
      for (const symbol of universeSymbols) {
        addReplayTarget(targets, { strategy, symbol }, universeSource);
      }
    }
  }

  const strategySymbolsEntries = await Promise.all(
    configuredStrategies.map(
      async (strategy) =>
        [
          strategy,
          await loadStrategyResultSymbols({ userName, strategy }),
        ] as const,
    ),
  );

  for (const [strategy, symbols] of strategySymbolsEntries) {
    for (const symbol of symbols) {
      if (explicitSymbolSet && !explicitSymbolSet.has(symbol)) {
        continue;
      }
      addReplayTarget(targets, { strategy, symbol }, 'strategyResults');
    }
  }

  return [...targets.values()].sort(
    (left, right) =>
      left.strategy.localeCompare(right.strategy) ||
      left.symbol.localeCompare(right.symbol),
  );
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
  strategy,
  symbol,
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
          trade.strategy === strategy &&
          trade.symbol === symbol &&
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
          evaluation.strategy === strategy &&
          evaluation.symbol === symbol &&
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

const buildReplayConfig = async ({
  userName,
  strategy,
  symbol,
  runtimeTrades,
  runtimeSignalEvaluations,
  toleranceMs,
}: Pick<ReplayTarget, 'strategy' | 'symbol'> & {
  userName: string;
  runtimeTrades: RuntimeTradeRecord[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
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
  const aiReplayAnalyses = buildReplayAiAnalyses({
    runtimeTrades,
    runtimeSignalEvaluations,
    strategy,
    symbol,
    toleranceMs,
  });

  return {
    ...(userConfig as StrategyConfig),
    ...(symbolConfig as StrategyConfig),
    ENV: REPLAY_ENV,
    MAKE_ORDERS: true,
    INTERVAL: interval,
    RECORD_RUNTIME_TRADES: false,
    ...(aiReplayAnalyses.length
      ? { AI_REPLAY_ANALYSES: aiReplayAnalyses }
      : {}),
  };
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

  await update(connector, interval, symbols, undefined, {
    connectorLabel: connectorName,
    preloadStart,
    preloadEnd,
  });

  const [binanceFactory, coinbaseFactory] = await Promise.all([
    getConnectorCreatorByName(ConnectorNames.Binance, projectRoot),
    getConnectorCreatorByName(ConnectorNames.Coinbase, projectRoot),
  ]);

  if (binanceFactory) {
    const binanceConnector = await (binanceFactory as ConnectorCreator)({
      userName,
    });
    await update(binanceConnector, interval, ['BTCUSDT'], undefined, {
      connectorLabel: ConnectorNames.Binance,
      preloadStart,
      preloadEnd,
    });
  } else {
    logger.warn(
      'Binance connector is unavailable. BTC reference replay may drift.',
    );
  }

  if (coinbaseFactory) {
    const coinbaseConnector = await (coinbaseFactory as ConnectorCreator)({
      userName,
    });
    await update(coinbaseConnector, interval, ['BTCUSDT'], undefined, {
      connectorLabel: ConnectorNames.Coinbase,
      preloadStart,
      preloadEnd,
    });
  } else {
    logger.warn(
      'Coinbase connector is unavailable. BTC reference replay may drift.',
    );
  }

  console.log(
    chalk.gray(`Warm history: done in ${formatDuration(warmStartedAt)}`),
  );
};

const formatPercent = (value: number | null) =>
  value == null || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(2)}%`;

const formatMinutes = (value: number | null) =>
  value == null || !Number.isFinite(value)
    ? 'n/a'
    : `${(value / 60_000).toFixed(2)}m`;

const formatEntryLabel = (entry: TradeParityEntry) =>
  `${entry.strategy} ${entry.symbol} ${entry.direction} ${formatUnix(entry.timestamp)}`;

const formatRuntimeEntriesSummary = ({
  rawRuntimeEntriesCount,
  runtimeEntriesCount,
  runtimeDuplicateEntriesCount,
}: {
  rawRuntimeEntriesCount: number;
  runtimeEntriesCount: number;
  runtimeDuplicateEntriesCount: number;
}) =>
  runtimeDuplicateEntriesCount > 0
    ? `${rawRuntimeEntriesCount} (deduped ${runtimeEntriesCount}, dup ${runtimeDuplicateEntriesCount})`
    : String(runtimeEntriesCount);

const formatSourceCountsSummary = (sourceCounts: ReplayTargetSourceCounts) => {
  const parts = [
    sourceCounts.runtime > 0 ? `runtime trades=${sourceCounts.runtime}` : null,
    sourceCounts.strategyResults > 0
      ? `strategy results=${sourceCounts.strategyResults}`
      : null,
    sourceCounts.explicitTickers > 0
      ? `explicit tickers=${sourceCounts.explicitTickers}`
      : null,
    sourceCounts.connectorUniverse > 0
      ? `full universe=${sourceCounts.connectorUniverse}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join(', ');
};

const normalizeSummaryText = (value: string, maxLength = 160) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

const pickFirstText = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

type MismatchSummaryRow = {
  timestamp: number;
  strategy: string;
  line: string;
};

const buildMismatchSummaryRows = ({
  classifiedRuntimeOnly,
  classifiedBacktestOnly,
}: {
  classifiedRuntimeOnly: ClassifiedRuntimeOnlyEntry[];
  classifiedBacktestOnly: ClassifiedBacktestOnlyEntry[];
}): MismatchSummaryRow[] => {
  const rows: MismatchSummaryRow[] = [];

  for (const item of classifiedRuntimeOnly) {
    const signalId = pickFirstText(
      item.entry.signalId,
      item.evaluation?.signalId,
    );
    const orderId = pickFirstText(item.entry.orderId, item.entry.id);
    const nearestBacktestSignalId = pickFirstText(
      item.nearestBacktestEntry?.signalId,
      item.nearestBacktestEntry?.id,
    );
    const refs = [`signalId=${signalId ?? 'n/a'}`];
    if (orderId && orderId !== signalId) {
      refs.push(`orderId=${orderId}`);
    }
    if (item.evaluation?.evaluationId) {
      refs.push(`evaluationId=${item.evaluation.evaluationId}`);
    }
    if (item.evaluation?.status) {
      refs.push(`evaluationStatus=${item.evaluation.status}`);
    }
    if (nearestBacktestSignalId) {
      refs.push(`nearestBacktest=${nearestBacktestSignalId}`);
    }
    if (item.evaluationTimestampDiffMs != null) {
      refs.push(`replayDrift=${formatMinutes(item.evaluationTimestampDiffMs)}`);
    }
    if (item.nearestBacktestEntryTimestampDiffMs != null) {
      refs.push(
        `backtestDrift=${formatMinutes(item.nearestBacktestEntryTimestampDiffMs)}`,
      );
    }

    rows.push({
      timestamp: item.entry.timestamp,
      strategy: item.entry.strategy,
      line: `runtimeOnly [${item.classification}] ${refs.join(' ')} ${formatEntryLabel(item.entry)} reason=${normalizeSummaryText(item.reason)}`,
    });
  }

  for (const item of classifiedBacktestOnly) {
    const signalId = pickFirstText(
      item.entry.signalId,
      item.signal?.signalId,
      item.evaluation?.signalId,
      item.entry.id,
    );
    const runtimeSignalId = pickFirstText(
      item.signal?.signalId,
      item.evaluation?.signalId,
    );
    const refs = [`signalId=${signalId ?? 'n/a'}`];
    if (runtimeSignalId && runtimeSignalId !== signalId) {
      refs.push(`runtimeSignalId=${runtimeSignalId}`);
    }
    if (item.evaluation?.evaluationId) {
      refs.push(`evaluationId=${item.evaluation.evaluationId}`);
    }
    if (item.signalTimestampDiffMs != null) {
      refs.push(`signalDrift=${formatMinutes(item.signalTimestampDiffMs)}`);
    }
    if (item.evaluationTimestampDiffMs != null) {
      refs.push(
        `evaluationDrift=${formatMinutes(item.evaluationTimestampDiffMs)}`,
      );
    }

    rows.push({
      timestamp: item.entry.timestamp,
      strategy: item.entry.strategy,
      line: `backtestOnly [${item.classification}] ${refs.join(' ')} ${formatEntryLabel(item.entry)} reason=${normalizeSummaryText(item.reason)}`,
    });
  }

  return rows.sort(
    (left, right) =>
      left.timestamp - right.timestamp ||
      left.strategy.localeCompare(right.strategy) ||
      left.line.localeCompare(right.line),
  );
};

const buildStrategyIssueRows = (
  strategyRows: Array<[string, StrategyParitySummaryRow]>,
) =>
  strategyRows
    .map(([strategy, row]) => {
      const issues: string[] = [];
      if (row.runtimeOnly) {
        issues.push(`runtimeOnly=${row.runtimeOnly}`);
      }
      if (row.backtestOnly) {
        issues.push(`backtestOnly=${row.backtestOnly}`);
      }
      if (row.runtimeDuplicates) {
        issues.push(`runtimeDuplicates=${row.runtimeDuplicates}`);
      }
      if (row.errors) {
        issues.push(`errors=${row.errors}`);
      }

      return issues.length ? `- ${strategy}: ${issues.join(', ')}` : null;
    })
    .filter((line): line is string => Boolean(line));

const toSerializableTradeParityEntry = (entry: TradeParityEntry | undefined) =>
  entry
    ? {
        id: entry.id,
        source: entry.source,
        strategy: entry.strategy,
        symbol: entry.symbol,
        direction: entry.direction,
        timestamp: entry.timestamp,
        price: entry.price,
        orderId: entry.orderId,
        signalId: entry.signalId,
      }
    : undefined;

const toSerializableSignal = (signal: Signal | undefined) =>
  signal
    ? {
        signalId: signal.signalId,
        orderId: signal.orderId,
        strategy: signal.strategy,
        symbol: signal.symbol,
        direction: signal.direction,
        timestamp: signal.timestamp,
        orderStatus: signal.orderStatus,
        orderSkipReason: signal.orderSkipReason,
        ml: signal.ml,
        aiAnalysis: signal.aiAnalysis,
      }
    : undefined;

const toSerializableRuntimeSignalEvaluation = (
  evaluation: RuntimeSignalEvaluationRecord | undefined,
) =>
  evaluation
    ? {
        evaluationId: evaluation.evaluationId,
        strategy: evaluation.strategy,
        symbol: evaluation.symbol,
        direction: evaluation.direction,
        timestamp: evaluation.timestamp,
        evaluatedAt: evaluation.evaluatedAt,
        status: evaluation.status,
        reason: evaluation.reason,
        signalId: evaluation.signalId,
        orderStatus: evaluation.orderStatus,
        orderSkipReason: evaluation.orderSkipReason,
        ml: evaluation.ml,
        aiAnalysis: evaluation.aiAnalysis,
      }
    : undefined;

const getRuntimeOnlyLikelyCause = (
  classification: RuntimeOnlyClassification,
) => {
  switch (classification) {
    case 'gated_out':
      return 'Replay saw the setup but blocked the trade with gate/order-skip logic.';
    case 'order_failed':
      return 'Replay saw the setup but order placement failed.';
    case 'core_skipped':
      return 'Replay strategy core did not emit a signal for this runtime trade.';
    case 'backtest_drift':
      return 'Replay has a nearby backtest entry, but it is outside the allowed timestamp tolerance.';
    case 'not_evaluated':
      return 'Replay produced no evaluation close to the runtime trade timestamp.';
    case 'true_mismatch':
      return 'Runtime and replay disagree after evaluation; inspect direction, statuses, and reason fields.';
  }
};

const getBacktestOnlyLikelyCause = (
  classification: BacktestOnlyClassification,
) => {
  switch (classification) {
    case 'gated_out':
      return 'Runtime/live path saw the setup but blocked the trade with gate/order-skip logic.';
    case 'order_failed':
      return 'Runtime/live path saw the setup but order placement failed.';
    case 'core_skipped':
      return 'Runtime evaluation skipped the setup while replay/backtest opened a trade.';
    case 'not_evaluated':
      return 'Runtime produced no signal or evaluation close to the backtest trade timestamp.';
    case 'true_mismatch':
      return 'Backtest opened a trade that runtime did not replicate; inspect signal/evaluation context.';
  }
};

const getRuntimeOnlyRecommendedChecks = (
  classification: RuntimeOnlyClassification,
) => {
  switch (classification) {
    case 'gated_out':
      return [
        'Check replay evaluation.orderStatus',
        'Check replay evaluation.orderSkipReason',
        'Compare AI/ML gate inputs',
      ];
    case 'order_failed':
      return [
        'Check replay evaluation.orderStatus',
        'Check replay evaluation.reason',
        'Check connector/order simulation path',
      ];
    case 'core_skipped':
      return [
        'Check replay evaluation.status',
        'Compare candle window and preload history',
        'Inspect strategy core conditions at entry timestamp',
      ];
    case 'backtest_drift':
      return [
        'Check nearest backtest timestamp',
        'Inspect toleranceBars/toleranceMs',
        'Compare candle alignment and exchange history',
      ];
    case 'not_evaluated':
      return [
        'Check replay target coverage',
        'Check replay evaluation generation',
        'Inspect symbol/strategy filtering',
      ];
    case 'true_mismatch':
      return [
        'Compare runtime trade vs replay evaluation',
        'Check direction and orderStatus',
        'Inspect strategy inputs around entry timestamp',
      ];
  }
};

const getBacktestOnlyRecommendedChecks = (
  classification: BacktestOnlyClassification,
) => {
  switch (classification) {
    case 'gated_out':
      return [
        'Check runtime signal.orderStatus',
        'Check runtime signal.orderSkipReason',
        'Compare AI/ML gate inputs',
      ];
    case 'order_failed':
      return [
        'Check runtime signal.orderStatus',
        'Check runtime evaluation.reason',
        'Inspect live order placement path',
      ];
    case 'core_skipped':
      return [
        'Check runtime evaluation.status',
        'Compare runtime signal direction',
        'Inspect strategy core conditions at entry timestamp',
      ];
    case 'not_evaluated':
      return [
        'Check runtime signal persistence',
        'Check evaluation generation',
        'Inspect symbol/strategy filtering',
      ];
    case 'true_mismatch':
      return [
        'Compare backtest entry vs runtime signal/evaluation',
        'Check direction and orderStatus',
        'Inspect runtime-specific filters',
      ];
  }
};

const buildRuntimeParityMismatchAttachment = ({
  window,
  connectorName,
  replayEnv,
  toleranceBars,
  toleranceMs,
  replayTargetsCount,
  comparedTargetsCount,
  replayErrors,
  sourceCounts,
  rawRuntimeEntriesCount,
  runtimeEntriesCount,
  runtimeDuplicateEntriesCount,
  backtestEntriesCount,
  matchedCount,
  runtimeOnlyCount,
  backtestOnlyCount,
  matchedSummary,
  classifiedRuntimeOnly,
  classifiedBacktestOnly,
  runtimeSignalEvaluationsCount,
  strategyRows,
}: {
  window: { start: number; end: number; source?: string };
  connectorName: string;
  replayEnv: string;
  toleranceBars: number;
  toleranceMs: number;
  replayTargetsCount: number;
  comparedTargetsCount: number;
  replayErrors: ReplayError[];
  sourceCounts: ReplayTargetSourceCounts;
  rawRuntimeEntriesCount: number;
  runtimeEntriesCount: number;
  runtimeDuplicateEntriesCount: number;
  backtestEntriesCount: number;
  matchedCount: number;
  runtimeOnlyCount: number;
  backtestOnlyCount: number;
  matchedSummary: ReturnType<typeof summarizeMatchedParity>;
  classifiedRuntimeOnly: ClassifiedRuntimeOnlyEntry[];
  classifiedBacktestOnly: ClassifiedBacktestOnlyEntry[];
  runtimeSignalEvaluationsCount: number;
  strategyRows: Array<[string, StrategyParitySummaryRow]>;
}) => {
  if (!classifiedRuntimeOnly.length && !classifiedBacktestOnly.length) {
    return null;
  }

  const cases = [
    ...classifiedRuntimeOnly.map((item) => ({
      kind: 'runtimeOnly' as const,
      strategy: item.entry.strategy,
      symbol: item.entry.symbol,
      direction: item.entry.direction,
      signalRefs: {
        signalId: item.entry.signalId ?? item.evaluation?.signalId,
        orderId: item.entry.orderId ?? item.entry.id,
        evaluationId: item.evaluation?.evaluationId,
      },
      why: {
        classification: item.classification,
        reason: item.reason,
        likelyCause: getRuntimeOnlyLikelyCause(item.classification),
      },
      timing: {
        entryTimestamp: item.entry.timestamp,
        replayEvaluationTimestamp: item.evaluation?.timestamp,
        replayEvaluatedAt: item.evaluation?.evaluatedAt,
        nearestBacktestTimestamp: item.nearestBacktestEntry?.timestamp,
        replayEvaluationDriftMs: item.evaluationTimestampDiffMs,
        nearestBacktestDriftMs: item.nearestBacktestEntryTimestampDiffMs,
      },
      decisionTrace: {
        replayEvaluationStatus: item.evaluation?.status,
        replayOrderStatus: item.evaluation?.orderStatus,
        replayOrderSkipReason: item.evaluation?.orderSkipReason,
      },
      recommendedChecks: getRuntimeOnlyRecommendedChecks(item.classification),
      artifacts: {
        runtimeEntry: toSerializableTradeParityEntry(item.entry),
        replayEvaluation: toSerializableRuntimeSignalEvaluation(
          item.evaluation,
        ),
        nearestBacktestEntry: toSerializableTradeParityEntry(
          item.nearestBacktestEntry,
        ),
      },
    })),
    ...classifiedBacktestOnly.map((item) => ({
      kind: 'backtestOnly' as const,
      strategy: item.entry.strategy,
      symbol: item.entry.symbol,
      direction: item.entry.direction,
      signalRefs: {
        signalId:
          item.entry.signalId ||
          item.signal?.signalId ||
          item.evaluation?.signalId ||
          item.entry.id,
        orderId: item.signal?.orderId,
        evaluationId: item.evaluation?.evaluationId,
      },
      why: {
        classification: item.classification,
        reason: item.reason,
        likelyCause: getBacktestOnlyLikelyCause(item.classification),
      },
      timing: {
        entryTimestamp: item.entry.timestamp,
        runtimeSignalTimestamp: item.signal?.timestamp,
        runtimeEvaluationTimestamp: item.evaluation?.timestamp,
        runtimeEvaluatedAt: item.evaluation?.evaluatedAt,
        runtimeSignalDriftMs: item.signalTimestampDiffMs,
        runtimeEvaluationDriftMs: item.evaluationTimestampDiffMs,
      },
      decisionTrace: {
        runtimeSignalOrderStatus: item.signal?.orderStatus,
        runtimeSignalOrderSkipReason: item.signal?.orderSkipReason,
        runtimeEvaluationStatus: item.evaluation?.status,
        runtimeEvaluationOrderStatus: item.evaluation?.orderStatus,
        runtimeEvaluationOrderSkipReason: item.evaluation?.orderSkipReason,
      },
      recommendedChecks: getBacktestOnlyRecommendedChecks(item.classification),
      artifacts: {
        backtestEntry: toSerializableTradeParityEntry(item.entry),
        runtimeSignal: toSerializableSignal(item.signal),
        runtimeEvaluation: toSerializableRuntimeSignalEvaluation(
          item.evaluation,
        ),
      },
    })),
  ];

  const payload = {
    kind: 'tradejs-runtime-parity-mismatches',
    version: 1,
    generatedAt: Date.now(),
    codexQuestion:
      'For each mismatch case, explain why runtime and replay/backtest diverged. Use why.classification first, then confirm with decisionTrace, timing, and artifacts.',
    window: {
      start: window.start,
      end: window.end,
      source: window.source,
    },
    connectorName,
    replayEnv,
    tolerance: {
      bars: toleranceBars,
      ms: toleranceMs,
    },
    summary: {
      replayTargets: replayTargetsCount,
      comparedTargets: comparedTargetsCount,
      replayErrors: replayErrors.length,
      sourceCounts,
      runtimeEntriesRaw: rawRuntimeEntriesCount,
      runtimeEntries: runtimeEntriesCount,
      runtimeDuplicateEntries: runtimeDuplicateEntriesCount,
      backtestEntries: backtestEntriesCount,
      matchedEntries: matchedCount,
      runtimeOnlyEntries: runtimeOnlyCount,
      backtestOnlyEntries: backtestOnlyCount,
      runtimeSignalEvaluations: runtimeSignalEvaluationsCount,
      matchedDeltas: {
        priceAvgPct: matchedSummary.avgPriceDeltaPct,
        priceMaxPct: matchedSummary.maxPriceDeltaPct,
        timeAvgMs: matchedSummary.avgTimestampDiffMs,
        timeMaxMs: matchedSummary.maxTimestampDiffMs,
      },
      strategyIssues: buildStrategyIssueRows(strategyRows).map((line) =>
        line.slice(2),
      ),
    },
    replayErrors: replayErrors.map((error) => ({
      strategy: error.strategy,
      symbol: error.symbol,
      sources: error.sources,
      message: error.message,
    })),
    cases,
    mismatches: {
      runtimeOnly: classifiedRuntimeOnly.map((item) => ({
        classification: item.classification,
        reason: item.reason,
        runtimeEntry: toSerializableTradeParityEntry(item.entry),
        replayEvaluation: toSerializableRuntimeSignalEvaluation(
          item.evaluation,
        ),
        replayEvaluationDriftMs: item.evaluationTimestampDiffMs,
        nearestBacktestEntry: toSerializableTradeParityEntry(
          item.nearestBacktestEntry,
        ),
        nearestBacktestDriftMs: item.nearestBacktestEntryTimestampDiffMs,
      })),
      backtestOnly: classifiedBacktestOnly.map((item) => ({
        classification: item.classification,
        reason: item.reason,
        backtestEntry: toSerializableTradeParityEntry(item.entry),
        runtimeSignal: toSerializableSignal(item.signal),
        runtimeSignalDriftMs: item.signalTimestampDiffMs,
        runtimeEvaluation: toSerializableRuntimeSignalEvaluation(
          item.evaluation,
        ),
        runtimeEvaluationDriftMs: item.evaluationTimestampDiffMs,
      })),
    },
  };

  return {
    filename: `runtime-parity-mismatches-${connectorName}-${window.start}-${window.end}.json`,
    content: JSON.stringify(payload, null, 2),
    caption: 'Runtime parity mismatch JSON',
  };
};

const printRuntimeDuplicateDetails = (groups: RuntimeDuplicateGroup[]) => {
  if (!groups.length) {
    return;
  }

  console.log('');
  console.log(chalk.yellow('Runtime duplicates'));

  for (const group of groups.slice(0, DETAIL_LIMIT)) {
    const ids = group.entries.map((entry) => entry.orderId ?? entry.id);

    console.log(
      `- ${formatEntryLabel(group.entries[0])} count=${group.entries.length}, duplicateEntries=${group.entries.length - 1}, ids=${ids.join(',')}`,
    );
  }

  if (groups.length > DETAIL_LIMIT) {
    console.log(`- ... ${groups.length - DETAIL_LIMIT} more`);
  }
};

const findNearestRuntimeSignal = ({
  entry,
  runtimeSignals,
  toleranceMs,
}: {
  entry: TradeParityEntry;
  runtimeSignals: Signal[];
  toleranceMs: number;
}) => {
  let bestSignal: Signal | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const signal of runtimeSignals) {
    if (
      signal.strategy !== entry.strategy ||
      signal.symbol !== entry.symbol ||
      signal.direction !== entry.direction
    ) {
      continue;
    }

    const diff = Math.abs(signal.timestamp - entry.timestamp);
    if (diff > toleranceMs || diff >= bestDiff) {
      continue;
    }

    bestSignal = signal;
    bestDiff = diff;
  }

  return bestSignal
    ? {
        signal: bestSignal,
        timestampDiffMs: bestDiff,
      }
    : null;
};

const findNearestRuntimeSignalEvaluation = ({
  entry,
  runtimeSignalEvaluations,
  toleranceMs,
}: {
  entry: TradeParityEntry;
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  toleranceMs: number;
}) => {
  let bestEvaluation: RuntimeSignalEvaluationRecord | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const evaluation of runtimeSignalEvaluations) {
    if (
      evaluation.strategy !== entry.strategy ||
      evaluation.symbol !== entry.symbol
    ) {
      continue;
    }

    const diff = Math.abs(evaluation.timestamp - entry.timestamp);
    if (diff > toleranceMs || diff >= bestDiff) {
      continue;
    }

    bestEvaluation = evaluation;
    bestDiff = diff;
  }

  return bestEvaluation
    ? {
        evaluation: bestEvaluation,
        timestampDiffMs: bestDiff,
      }
    : null;
};

const findNearestBacktestEntryForRuntimeOnly = ({
  entry,
  backtestEntries,
}: {
  entry: TradeParityEntry;
  backtestEntries: TradeParityEntry[];
}) => {
  let bestEntry: TradeParityEntry | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const backtestEntry of backtestEntries) {
    if (
      backtestEntry.strategy !== entry.strategy ||
      backtestEntry.symbol !== entry.symbol ||
      backtestEntry.direction !== entry.direction
    ) {
      continue;
    }

    const diff = Math.abs(backtestEntry.timestamp - entry.timestamp);
    if (diff >= bestDiff) {
      continue;
    }

    bestEntry = backtestEntry;
    bestDiff = diff;
  }

  return bestEntry
    ? {
        entry: bestEntry,
        timestampDiffMs: bestDiff,
      }
    : null;
};

const buildSignalClassificationReason = ({
  signal,
  orderStatus,
  classification,
}: {
  signal: Signal;
  orderStatus: SignalOrderStatus | 'unknown';
  classification: BacktestOnlyClassification;
}) => {
  const skipReason =
    typeof signal.orderSkipReason === 'string'
      ? signal.orderSkipReason.trim()
      : '';
  if (skipReason) {
    return skipReason;
  }

  if (classification === 'gated_out' && signal.ml?.passed === false) {
    return `ml_probability=${signal.ml.probability.toFixed(4)} threshold=${signal.ml.threshold.toFixed(4)}`;
  }

  if (orderStatus === 'completed') {
    return 'completed_signal_without_runtime_trade';
  }

  if (orderStatus !== 'unknown') {
    return `orderStatus=${orderStatus}`;
  }

  return 'runtime_signal_without_completed_trade';
};

const buildEvaluationClassification = ({
  entry,
  evaluation,
}: {
  entry: TradeParityEntry;
  evaluation: RuntimeSignalEvaluationRecord;
}): Pick<ClassifiedBacktestOnlyEntry, 'classification' | 'reason'> => {
  if (evaluation.status === 'skip') {
    return {
      classification: 'core_skipped',
      reason: evaluation.reason || 'NO_SIGNAL',
    };
  }

  if (evaluation.status === 'error') {
    return {
      classification: 'true_mismatch',
      reason: evaluation.reason || 'runtime_evaluation_error',
    };
  }

  if (evaluation.direction && evaluation.direction !== entry.direction) {
    return {
      classification: 'core_skipped',
      reason: `runtime_signal_direction=${evaluation.direction}`,
    };
  }

  const orderStatus = normalizeSignalOrderStatus(evaluation.orderStatus);
  if (orderStatus === 'failed') {
    return {
      classification: 'order_failed',
      reason: evaluation.reason || 'orderStatus=failed',
    };
  }

  if (
    orderStatus === 'skipped' ||
    orderStatus === 'canceled' ||
    (typeof evaluation.orderSkipReason === 'string' &&
      evaluation.orderSkipReason.trim())
  ) {
    return {
      classification: 'gated_out',
      reason:
        evaluation.orderSkipReason ||
        evaluation.reason ||
        `orderStatus=${orderStatus}`,
    };
  }

  if (orderStatus === 'completed') {
    return {
      classification: 'true_mismatch',
      reason: 'completed_signal_without_runtime_trade',
    };
  }

  return {
    classification: 'true_mismatch',
    reason: evaluation.reason || 'runtime_signal_without_completed_trade',
  };
};

const buildRuntimeOnlyEvaluationClassification = ({
  entry,
  evaluation,
}: {
  entry: TradeParityEntry;
  evaluation: RuntimeSignalEvaluationRecord;
}): Pick<ClassifiedRuntimeOnlyEntry, 'classification' | 'reason'> => {
  if (evaluation.status === 'skip') {
    return {
      classification: 'core_skipped',
      reason: evaluation.reason || 'NO_SIGNAL',
    };
  }

  if (evaluation.status === 'error') {
    return {
      classification: 'true_mismatch',
      reason: evaluation.reason || 'replay_evaluation_error',
    };
  }

  if (evaluation.direction && evaluation.direction !== entry.direction) {
    return {
      classification: 'true_mismatch',
      reason: `replay_signal_direction=${evaluation.direction}`,
    };
  }

  const orderStatus = normalizeSignalOrderStatus(evaluation.orderStatus);
  if (orderStatus === 'failed') {
    return {
      classification: 'order_failed',
      reason: evaluation.reason || 'orderStatus=failed',
    };
  }

  if (
    orderStatus === 'skipped' ||
    orderStatus === 'canceled' ||
    (typeof evaluation.orderSkipReason === 'string' &&
      evaluation.orderSkipReason.trim())
  ) {
    return {
      classification: 'gated_out',
      reason:
        evaluation.orderSkipReason ||
        evaluation.reason ||
        `orderStatus=${orderStatus}`,
    };
  }

  if (orderStatus === 'completed') {
    return {
      classification: 'true_mismatch',
      reason: 'completed_replay_signal_without_backtest_trade',
    };
  }

  return {
    classification: 'true_mismatch',
    reason: evaluation.reason || 'runtime_trade_without_replay_trade',
  };
};

const classifyBacktestOnlyEntries = ({
  entries,
  runtimeSignals,
  runtimeSignalEvaluations,
  toleranceMs,
}: {
  entries: TradeParityEntry[];
  runtimeSignals: Signal[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  toleranceMs: number;
}): ClassifiedBacktestOnlyEntry[] =>
  entries.map((entry) => {
    const nearestSignal = findNearestRuntimeSignal({
      entry,
      runtimeSignals,
      toleranceMs,
    });

    if (!nearestSignal) {
      const nearestEvaluation = findNearestRuntimeSignalEvaluation({
        entry,
        runtimeSignalEvaluations,
        toleranceMs,
      });

      if (nearestEvaluation) {
        const evaluationClassification = buildEvaluationClassification({
          entry,
          evaluation: nearestEvaluation.evaluation,
        });

        return {
          entry,
          ...evaluationClassification,
          evaluation: nearestEvaluation.evaluation,
          evaluationTimestampDiffMs: nearestEvaluation.timestampDiffMs,
        };
      }

      return {
        entry,
        classification: 'not_evaluated',
        reason: 'no_runtime_evaluation',
      };
    }

    const orderStatus = normalizeSignalOrderStatus(
      nearestSignal.signal.orderStatus,
    );
    let classification: BacktestOnlyClassification;

    if (orderStatus === 'failed') {
      classification = 'order_failed';
    } else if (
      orderStatus === 'skipped' ||
      orderStatus === 'canceled' ||
      nearestSignal.signal.ml?.passed === false ||
      (typeof nearestSignal.signal.orderSkipReason === 'string' &&
        nearestSignal.signal.orderSkipReason.trim())
    ) {
      classification = 'gated_out';
    } else {
      classification = 'true_mismatch';
    }

    return {
      entry,
      classification,
      reason: buildSignalClassificationReason({
        signal: nearestSignal.signal,
        orderStatus,
        classification,
      }),
      signal: nearestSignal.signal,
      signalTimestampDiffMs: nearestSignal.timestampDiffMs,
    };
  });

const classifyRuntimeOnlyEntries = ({
  entries,
  replaySignalEvaluations,
  backtestEntries,
  toleranceMs,
}: {
  entries: TradeParityEntry[];
  replaySignalEvaluations: RuntimeSignalEvaluationRecord[];
  backtestEntries: TradeParityEntry[];
  toleranceMs: number;
}): ClassifiedRuntimeOnlyEntry[] =>
  entries.map((entry) => {
    const nearestBacktestEntry = findNearestBacktestEntryForRuntimeOnly({
      entry,
      backtestEntries,
    });
    if (
      nearestBacktestEntry &&
      nearestBacktestEntry.timestampDiffMs > toleranceMs
    ) {
      return {
        entry,
        classification: 'backtest_drift',
        reason: `nearest_backtest_entry_drift=${formatMinutes(nearestBacktestEntry.timestampDiffMs)}`,
        nearestBacktestEntry: nearestBacktestEntry.entry,
        nearestBacktestEntryTimestampDiffMs:
          nearestBacktestEntry.timestampDiffMs,
      };
    }

    const nearestEvaluation = findNearestRuntimeSignalEvaluation({
      entry,
      runtimeSignalEvaluations: replaySignalEvaluations,
      toleranceMs,
    });
    if (!nearestEvaluation) {
      return {
        entry,
        classification: 'not_evaluated',
        reason: 'no_replay_evaluation',
      };
    }

    return {
      entry,
      ...buildRuntimeOnlyEvaluationClassification({
        entry,
        evaluation: nearestEvaluation.evaluation,
      }),
      evaluation: nearestEvaluation.evaluation,
      evaluationTimestampDiffMs: nearestEvaluation.timestampDiffMs,
    };
  });

const summarizeBacktestOnlyClassifications = (
  classifiedEntries: ClassifiedBacktestOnlyEntry[],
) => {
  const counts = new Map<BacktestOnlyClassification, number>(
    BACKTEST_ONLY_CLASSIFICATIONS.map((classification) => [classification, 0]),
  );

  for (const item of classifiedEntries) {
    counts.set(item.classification, (counts.get(item.classification) ?? 0) + 1);
  }

  const nonZero = BACKTEST_ONLY_CLASSIFICATIONS.flatMap((classification) => {
    const count = counts.get(classification) ?? 0;
    return count > 0 ? [`${classification}=${count}`] : [];
  });

  return nonZero.join(', ');
};

const summarizeRuntimeOnlyClassifications = (
  classifiedEntries: ClassifiedRuntimeOnlyEntry[],
) => {
  const counts = new Map<RuntimeOnlyClassification, number>(
    RUNTIME_ONLY_CLASSIFICATIONS.map((classification) => [classification, 0]),
  );

  for (const item of classifiedEntries) {
    counts.set(item.classification, (counts.get(item.classification) ?? 0) + 1);
  }

  const nonZero = RUNTIME_ONLY_CLASSIFICATIONS.flatMap((classification) => {
    const count = counts.get(classification) ?? 0;
    return count > 0 ? [`${classification}=${count}`] : [];
  });

  return nonZero.join(', ');
};

const printClassifiedBacktestOnlyDetails = (
  classifiedEntries: ClassifiedBacktestOnlyEntry[],
) => {
  if (!classifiedEntries.length) {
    return;
  }

  console.log('');
  console.log(chalk.yellow('Backtest only'));

  for (const item of classifiedEntries.slice(0, DETAIL_LIMIT)) {
    const evidenceSuffix = item.signal
      ? ` signalId=${item.signal.signalId} signalDrift=${formatMinutes(item.signalTimestampDiffMs ?? null)}`
      : item.evaluation
        ? ` evaluationId=${item.evaluation.evaluationId} evaluationDrift=${formatMinutes(item.evaluationTimestampDiffMs ?? null)}`
        : '';

    const price =
      item.entry.price == null ? 'n/a' : item.entry.price.toFixed(6);

    console.log(
      `- [${item.classification}] ${formatEntryLabel(item.entry)} price=${price} id=${item.entry.id} reason=${item.reason}${evidenceSuffix}`,
    );
  }

  if (classifiedEntries.length > DETAIL_LIMIT) {
    console.log(`- ... ${classifiedEntries.length - DETAIL_LIMIT} more`);
  }
};

const printClassifiedRuntimeOnlyDetails = (
  classifiedEntries: ClassifiedRuntimeOnlyEntry[],
) => {
  if (!classifiedEntries.length) {
    return;
  }

  console.log('');
  console.log(chalk.yellow('Runtime only'));

  for (const item of classifiedEntries.slice(0, DETAIL_LIMIT)) {
    const evidenceSuffix = item.nearestBacktestEntry
      ? ` nearestBacktestId=${item.nearestBacktestEntry.id} backtestDrift=${formatMinutes(item.nearestBacktestEntryTimestampDiffMs ?? null)}`
      : item.evaluation
        ? ` replayEvaluationId=${item.evaluation.evaluationId} replayDrift=${formatMinutes(item.evaluationTimestampDiffMs ?? null)} status=${item.evaluation.status}`
        : '';
    const price =
      item.entry.price == null ? 'n/a' : item.entry.price.toFixed(6);

    console.log(
      `- [${item.classification}] ${formatEntryLabel(item.entry)} price=${price} id=${item.entry.id} reason=${item.reason}${evidenceSuffix}`,
    );
  }

  if (classifiedEntries.length > DETAIL_LIMIT) {
    console.log(`- ... ${classifiedEntries.length - DETAIL_LIMIT} more`);
  }
};

const summarizeByStrategy = ({
  targets,
  successfulTargetKeys,
  replayErrors,
  runtimeEntries,
  runtimeDuplicateEntries,
  backtestEntries,
  matchedEntries,
  runtimeOnlyEntries,
  backtestOnlyEntries,
}: {
  targets: ReplayTarget[];
  successfulTargetKeys: Set<string>;
  replayErrors: ReplayError[];
  runtimeEntries: TradeParityEntry[];
  runtimeDuplicateEntries: TradeParityEntry[];
  backtestEntries: TradeParityEntry[];
  matchedEntries: ReturnType<typeof compareTradeParityEntries>['matched'];
  runtimeOnlyEntries: TradeParityEntry[];
  backtestOnlyEntries: TradeParityEntry[];
}) => {
  const rows = new Map<string, StrategyParitySummaryRow>();

  const ensureRow = (strategy: string) => {
    const row = rows.get(strategy) ?? {
      runtime: 0,
      runtimeDuplicates: 0,
      backtest: 0,
      matched: 0,
      runtimeOnly: 0,
      backtestOnly: 0,
      targets: 0,
      compared: 0,
      errors: 0,
    };
    rows.set(strategy, row);
    return row;
  };

  for (const target of targets) {
    const row = ensureRow(target.strategy);
    row.targets += 1;
    if (successfulTargetKeys.has(toTargetKey(target))) {
      row.compared += 1;
    }
  }
  for (const error of replayErrors) {
    ensureRow(error.strategy).errors += 1;
  }
  for (const entry of runtimeEntries) {
    ensureRow(entry.strategy).runtime += 1;
  }
  for (const entry of runtimeDuplicateEntries) {
    ensureRow(entry.strategy).runtimeDuplicates += 1;
  }
  for (const entry of backtestEntries) {
    ensureRow(entry.strategy).backtest += 1;
  }
  for (const entry of matchedEntries) {
    ensureRow(entry.runtime.strategy).matched += 1;
  }
  for (const entry of runtimeOnlyEntries) {
    ensureRow(entry.strategy).runtimeOnly += 1;
  }
  for (const entry of backtestOnlyEntries) {
    ensureRow(entry.strategy).backtestOnly += 1;
  }

  return [...rows.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
};

export const buildRuntimeParityMessage = ({
  window,
  connectorName,
  replayEnv,
  runtimeGatesEnabled,
  toleranceBars,
  toleranceMs,
  replayTargetsCount,
  comparedTargetsCount,
  replayErrors,
  sourceCounts,
  rawRuntimeEntriesCount,
  runtimeEntriesCount,
  runtimeDuplicateEntriesCount,
  backtestEntriesCount,
  matchedCount,
  runtimeOnlyCount,
  backtestOnlyCount,
  matchedSummary,
  classifiedRuntimeOnly,
  classifiedBacktestOnly,
  runtimeSignalEvaluationsCount,
  strategyRows,
  runtimeGateWarningCounts,
}: {
  window: { start: number; end: number };
  connectorName: string;
  replayEnv: string;
  runtimeGatesEnabled: boolean;
  toleranceBars: number;
  toleranceMs: number;
  replayTargetsCount: number;
  comparedTargetsCount: number;
  replayErrors: ReplayError[];
  sourceCounts: ReplayTargetSourceCounts;
  rawRuntimeEntriesCount: number;
  runtimeEntriesCount: number;
  runtimeDuplicateEntriesCount: number;
  backtestEntriesCount: number;
  matchedCount: number;
  runtimeOnlyCount: number;
  backtestOnlyCount: number;
  matchedSummary: ReturnType<typeof summarizeMatchedParity>;
  classifiedRuntimeOnly: ClassifiedRuntimeOnlyEntry[];
  classifiedBacktestOnly: ClassifiedBacktestOnlyEntry[];
  runtimeSignalEvaluationsCount: number;
  strategyRows: Array<[string, StrategyParitySummaryRow]>;
  runtimeGateWarningCounts: Map<string, number>;
}) => {
  const lines: string[] = [];

  lines.push('🧪 <b>TradeJS runtime parity</b>');
  lines.push('');
  lines.push('🕒 <b>Window</b>');
  lines.push(
    `<b>${escapeHtml(formatMskDateTime(window.start))} - ${escapeHtml(formatMskDateTime(window.end))} ${SUMMARY_TIMEZONE_LABEL}</b>`,
  );
  lines.push('');
  lines.push(`🔌 Connector: <b>${escapeHtml(connectorName)}</b>`);
  lines.push(`🧬 Replay env: <b>${escapeHtml(replayEnv)}</b>`);
  lines.push(
    `🎯 Tolerance: <b>${toleranceBars} bar(s) / ${(toleranceMs / 60_000).toFixed(0)}m</b>`,
  );
  lines.push('');
  lines.push('📌 <b>Overview</b>');
  lines.push(
    `• Targets: <b>${replayTargetsCount}</b> / compared <b>${comparedTargetsCount}</b> / errors <b>${replayErrors.length}</b>`,
  );
  lines.push(
    `• Sources: <b>${escapeHtml(formatSourceCountsSummary(sourceCounts))}</b>`,
  );
  lines.push('');
  lines.push('📈 <b>Entries</b>');
  lines.push(
    `• Runtime: <b>${escapeHtml(
      formatRuntimeEntriesSummary({
        rawRuntimeEntriesCount,
        runtimeEntriesCount,
        runtimeDuplicateEntriesCount,
      }),
    )}</b>`,
  );
  lines.push(`• Backtest: <b>${backtestEntriesCount}</b>`);
  lines.push(
    `• Runtime only: <b>${runtimeOnlyCount}</b> / Backtest only: <b>${backtestOnlyCount}</b>`,
  );
  lines.push(
    `• Matched deltas: price avg/max=<b>${escapeHtml(formatPercent(matchedSummary.avgPriceDeltaPct))} / ${escapeHtml(formatPercent(matchedSummary.maxPriceDeltaPct))}</b>, time avg/max=<b>${escapeHtml(formatMinutes(matchedSummary.avgTimestampDiffMs))} / ${escapeHtml(formatMinutes(matchedSummary.maxTimestampDiffMs))}</b>`,
  );

  if (classifiedRuntimeOnly.length) {
    lines.push(
      `• Runtime-only classes: <code>${escapeHtml(summarizeRuntimeOnlyClassifications(classifiedRuntimeOnly))}</code>`,
    );
  }

  if (classifiedBacktestOnly.length) {
    lines.push(
      `• Backtest-only classes: <code>${escapeHtml(summarizeBacktestOnlyClassifications(classifiedBacktestOnly))}</code>`,
    );
  }

  if (runtimeSignalEvaluationsCount) {
    lines.push(
      `• Runtime evaluations: <b>${runtimeSignalEvaluationsCount}</b>`,
    );
  }

  const mismatchRows = buildMismatchSummaryRows({
    classifiedRuntimeOnly,
    classifiedBacktestOnly,
  });
  if (mismatchRows.length) {
    lines.push('');
    lines.push(`🔎 <b>Mismatches</b>`);
    for (const item of mismatchRows.slice(0, TELEGRAM_DETAIL_LIMIT)) {
      lines.push(`• <code>${escapeHtml(item.line)}</code>`);
    }
    if (mismatchRows.length > TELEGRAM_DETAIL_LIMIT) {
      lines.push(
        `... <b>${mismatchRows.length - TELEGRAM_DETAIL_LIMIT}</b> more`,
      );
    }
  }

  const strategyIssueRows = buildStrategyIssueRows(strategyRows);
  if (strategyIssueRows.length) {
    lines.push('');
    lines.push('📊 <b>Strategy issues</b>');
    for (const line of strategyIssueRows) {
      lines.push(`• ${escapeHtml(line.slice(2))}`);
    }
  } else if (strategyRows.length) {
    lines.push('');
    lines.push(
      `📊 <b>Strategies</b>: clean <b>${strategyRows.length}</b> / total <b>${strategyRows.length}</b>`,
    );
  }

  if (runtimeGateWarningCounts.size && !runtimeGatesEnabled) {
    lines.push('');
    lines.push('⚠️ <b>Warnings</b>');
    for (const [strategy, count] of [
      ...runtimeGateWarningCounts.entries(),
    ].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(
        `• <b>${escapeHtml(strategy)}</b>: AI/ML runtime gates configured on <b>${count}</b> target(s); BACKTEST replay covers core execution only.`,
      );
    }
  }

  if (replayErrors.length) {
    lines.push('');
    lines.push('❌ <b>Replay errors</b>');
    for (const error of replayErrors.slice(0, TELEGRAM_DETAIL_LIMIT)) {
      lines.push(
        `• <b>${escapeHtml(error.strategy)}</b> ${escapeHtml(error.symbol)}: <code>${escapeHtml(error.message)}</code>`,
      );
    }
    if (replayErrors.length > TELEGRAM_DETAIL_LIMIT) {
      lines.push(
        `... <b>${replayErrors.length - TELEGRAM_DETAIL_LIMIT}</b> more`,
      );
    }
  }

  return lines.join('\n');
};

const buildRuntimeParityNoTargetsMessage = ({
  window,
  connectorName,
  replayEnv,
  runtimeGatesEnabled,
  userName,
}: {
  window: { start: number; end: number };
  connectorName: string;
  replayEnv: string;
  runtimeGatesEnabled: boolean;
  userName: string;
}) =>
  [
    '🧪 <b>TradeJS runtime parity</b>',
    '',
    '🕒 <b>Window</b>',
    `<b>${escapeHtml(formatMskDateTime(window.start))} - ${escapeHtml(formatMskDateTime(window.end))} ${SUMMARY_TIMEZONE_LABEL}</b>`,
    '',
    `🔌 Connector: <b>${escapeHtml(connectorName)}</b>`,
    `🧬 Replay env: <b>${escapeHtml(replayEnv)}</b>`,
    '',
    `⚠️ No replay targets found for user <b>${escapeHtml(userName)}</b>.`,
  ].join('\n');

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
    const [allRuntimeTrades, allRuntimeSignals, allRuntimeSignalEvaluations] =
      await Promise.all([
        loadRuntimeTrades(flags.user),
        loadRuntimeSignals(flags.user),
        loadRuntimeSignalEvaluations(flags.user),
      ]);
    const runtimeTrades = allRuntimeTrades.filter(
      (trade) =>
        trade.entryTimestamp >= window.start &&
        trade.entryTimestamp <= window.end &&
        (!flags.strategy || trade.strategy === flags.strategy),
    );
    const runtimeSignals = allRuntimeSignals.filter(
      (signal) =>
        signal.timestamp >= window.start &&
        signal.timestamp <= window.end &&
        (!flags.strategy || signal.strategy === flags.strategy) &&
        (!requestedSymbolSet || requestedSymbolSet.has(signal.symbol)),
    );
    const runtimeSignalEvaluations = allRuntimeSignalEvaluations.filter(
      (evaluation) =>
        evaluation.timestamp >= window.start &&
        evaluation.timestamp <= window.end &&
        (!flags.strategy || evaluation.strategy === flags.strategy) &&
        (!requestedSymbolSet || requestedSymbolSet.has(evaluation.symbol)),
    );
    const connectorSymbols = requestedSymbols.length
      ? requestedSymbols
      : await getTickers(parityConnector);

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
            replayEnv: REPLAY_ENV,
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
        const replayConfig = await buildReplayConfig({
          userName: flags.user,
          strategy: target.strategy,
          symbol: target.symbol,
          runtimeTrades,
          runtimeSignalEvaluations,
          toleranceMs,
        });

        if (
          replayConfig.AI_ENABLED === true ||
          replayConfig.ML_ENABLED === true
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

    const comparableRuntimeTrades = runtimeTrades.filter((trade) =>
      successfulTargetKeys.has(toTargetKey(trade)),
    );
    const rawRuntimeEntries = extractRuntimeParityEntries(
      comparableRuntimeTrades,
    );
    const runtimeDedupe = dedupeRuntimeParityEntries(rawRuntimeEntries);
    const runtimeEntries = runtimeDedupe.entries;
    const comparison = compareTradeParityEntries({
      runtimeEntries,
      backtestEntries,
      toleranceMs,
    });
    const classifiedBacktestOnly = classifyBacktestOnlyEntries({
      entries: comparison.backtestOnly,
      runtimeSignals,
      runtimeSignalEvaluations,
      toleranceMs,
    });
    const classifiedRuntimeOnly = classifyRuntimeOnlyEntries({
      entries: comparison.runtimeOnly,
      replaySignalEvaluations,
      backtestEntries,
      toleranceMs,
    });
    const summary = summarizeMatchedParity(comparison.matched);

    console.log(chalk.cyan('TradeJS runtime parity'));
    console.log(
      `Window: ${formatUnix(window.start)} -> ${formatUnix(window.end)} (${window.source})`,
    );
    console.log(`Connector: ${connectorName}`);
    console.log(
      `Replay env: ${REPLAY_ENV}${
        flags.runtimeGates
          ? ' (runtime AI/ML gates enabled)'
          : ' (core/backtest gates only)'
      }`,
    );
    console.log(
      `Tolerance: ${toleranceBars} bar(s) / ${(toleranceMs / 60_000).toFixed(0)}m`,
    );
    console.log(
      `Summary: targets=${replayTargets.length}, compared=${successfulTargetKeys.size}, errors=${replayErrors.length}, runtime=${runtimeEntries.length}, backtest=${backtestEntries.length}, runtimeOnly=${comparison.runtimeOnly.length}, backtestOnly=${comparison.backtestOnly.length}, evaluations=${runtimeSignalEvaluations.length}`,
    );
    console.log(`Sources: ${formatSourceCountsSummary(sourceCounts)}`);
    console.log(
      `Runtime entries: ${formatRuntimeEntriesSummary({
        rawRuntimeEntriesCount: rawRuntimeEntries.length,
        runtimeEntriesCount: runtimeEntries.length,
        runtimeDuplicateEntriesCount: runtimeDedupe.duplicateEntries.length,
      })}`,
    );
    console.log(
      `Matched deltas: price avg/max=${formatPercent(summary.avgPriceDeltaPct)} / ${formatPercent(summary.maxPriceDeltaPct)}, time avg/max=${formatMinutes(summary.avgTimestampDiffMs)} / ${formatMinutes(summary.maxTimestampDiffMs)}`,
    );
    if (runtimeDedupe.duplicateGroups.length) {
      console.log(
        `Runtime duplicate groups: ${runtimeDedupe.duplicateGroups.length}, duplicate entries: ${runtimeDedupe.duplicateEntries.length}`,
      );
    }
    if (classifiedRuntimeOnly.length) {
      console.log(
        `Runtime only classifications: ${summarizeRuntimeOnlyClassifications(classifiedRuntimeOnly)}`,
      );
    }
    if (classifiedBacktestOnly.length) {
      console.log(
        `Backtest only classifications: ${summarizeBacktestOnlyClassifications(classifiedBacktestOnly)}`,
      );
    }
    if (runtimeSignalEvaluations.length) {
      console.log(`Runtime evaluations: ${runtimeSignalEvaluations.length}`);
    }

    const strategyRows = summarizeByStrategy({
      targets: replayTargets,
      successfulTargetKeys,
      replayErrors,
      runtimeEntries,
      runtimeDuplicateEntries: runtimeDedupe.duplicateEntries,
      backtestEntries,
      matchedEntries: comparison.matched,
      runtimeOnlyEntries: comparison.runtimeOnly,
      backtestOnlyEntries: comparison.backtestOnly,
    });
    const mismatchRows = buildMismatchSummaryRows({
      classifiedRuntimeOnly,
      classifiedBacktestOnly,
    });
    const strategyIssueRows = buildStrategyIssueRows(strategyRows);

    if (mismatchRows.length) {
      console.log('');
      console.log(chalk.yellow('Signal mismatches'));
      for (const item of mismatchRows.slice(0, DETAIL_LIMIT)) {
        console.log(`- ${item.line}`);
      }
      if (mismatchRows.length > DETAIL_LIMIT) {
        console.log(`- ... ${mismatchRows.length - DETAIL_LIMIT} more`);
      }
    }

    console.log('');
    if (strategyIssueRows.length) {
      console.log(chalk.cyan('Strategy issues'));
      for (const line of strategyIssueRows) {
        console.log(line);
      }
    } else if (strategyRows.length) {
      console.log(
        `Strategies: clean ${strategyRows.length}/${strategyRows.length}`,
      );
    }

    if (runtimeGateWarningCounts.size && !flags.runtimeGates) {
      console.log('');
      console.log(chalk.yellow('Warnings'));
      for (const [strategy, count] of [
        ...runtimeGateWarningCounts.entries(),
      ].sort(([left], [right]) => left.localeCompare(right))) {
        console.log(
          `- ${strategy} uses AI/ML runtime gates on ${count} replay target(s); BACKTEST replay covers core execution, not live gating.`,
        );
      }
    }

    if (replayErrors.length) {
      console.log('');
      console.log(chalk.red('Replay errors'));
      for (const error of replayErrors.slice(0, DETAIL_LIMIT)) {
        console.log(`- ${error.strategy} ${error.symbol}: ${error.message}`);
      }
      if (replayErrors.length > DETAIL_LIMIT) {
        console.log(`- ... ${replayErrors.length - DETAIL_LIMIT} more`);
      }
    }

    if (flags.details) {
      printRuntimeDuplicateDetails(runtimeDedupe.duplicateGroups);
      printClassifiedRuntimeOnlyDetails(classifiedRuntimeOnly);
      printClassifiedBacktestOnlyDetails(classifiedBacktestOnly);
    }

    if (flags.notify) {
      const mismatchAttachment = buildRuntimeParityMismatchAttachment({
        window,
        connectorName,
        replayEnv: REPLAY_ENV,
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
          replayEnv: REPLAY_ENV,
          runtimeGatesEnabled: Boolean(flags.runtimeGates),
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

if (require.main === module) {
  runtimeParity()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
