import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import args from 'args';
import chalk from 'chalk';
import { ConnectorNames } from '@tradejs/connectors';
import { formatUnix } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import { getData, getKeys, redisKeys } from '@tradejs/infra/redis';
import { update } from '@tradejs/node/cli';
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
import { resolveTimeWindow } from '../lib/timeWindow';

args.option(['u', 'user'], 'Use user config', 'root');
args.option(
  'connector',
  'Connector provider or name for parity replay (e.g. bybit, binance, coinbase, custom)',
  'bybit',
);
args.option(['d', 'days'], 'Replay window in days', 3);
args.option('startTime', 'Explicit replay start timestamp (ms or seconds)');
args.option('endTime', 'Explicit replay end timestamp (ms or seconds)');
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
  'toleranceBars',
  'Allowed entry timestamp drift in bars when matching runtime vs backtest',
  1,
);
args.option(['D', 'details'], 'Print unmatched entry details (capped)', false);

const flags = args.parse(process.argv);
const interval = '15' as Interval;
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
const DEFAULT_LOOKBACK_DAYS = 3;
const DETAIL_LIMIT = 10;

type ReplayTarget = {
  strategy: string;
  symbol: string;
  sources: Array<
    'runtime' | 'strategyResults' | 'runtimeUniverse' | 'explicitTickers'
  >;
};

type ReplayError = ReplayTarget & {
  message: string;
};

type BacktestOnlyClassification =
  | 'gated_out'
  | 'order_failed'
  | 'not_evaluated'
  | 'true_mismatch';

type ClassifiedBacktestOnlyEntry = {
  entry: TradeParityEntry;
  classification: BacktestOnlyClassification;
  reason: string;
  signal?: Signal;
  signalTimestampDiffMs?: number;
};

const BACKTEST_ONLY_CLASSIFICATIONS: BacktestOnlyClassification[] = [
  'gated_out',
  'order_failed',
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

const isSignalRecord = (value: unknown): value is Signal => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.signalId === 'string' &&
    typeof record.strategy === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.timestamp === 'number' &&
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

const loadRuntimeSignals = async (userName: string): Promise<Signal[]> => {
  const keys = await getKeys(redisKeys.runtimeSignals(userName));
  const signals = await Promise.all(keys.map((key) => getData(key, null)));

  return signals
    .filter(isSignalRecord)
    .sort((left, right) => left.timestamp - right.timestamp);
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

const buildReplayTargets = async ({
  userName,
  runtimeTrades,
  strategyFilter,
  explicitSymbols,
}: {
  userName: string;
  runtimeTrades: RuntimeTradeRecord[];
  strategyFilter?: string;
  explicitSymbols: string[];
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

  const runtimeSymbols = [
    ...new Set(
      runtimeTrades
        .map((trade) => trade.symbol)
        .filter(
          (symbol) => !explicitSymbolSet || explicitSymbolSet.has(symbol),
        ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const universeSymbols = explicitSymbols.length
    ? explicitSymbols
    : runtimeSymbols;
  const universeSource = explicitSymbols.length
    ? 'explicitTickers'
    : 'runtimeUniverse';

  for (const strategy of configuredStrategies) {
    for (const symbol of universeSymbols) {
      addReplayTarget(targets, { strategy, symbol }, universeSource);
    }
  }

  for (const strategy of configuredStrategies) {
    const symbols = await loadStrategyResultSymbols({ userName, strategy });
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

const buildReplayConfig = async ({
  userName,
  strategy,
  symbol,
}: Pick<ReplayTarget, 'strategy' | 'symbol'> & {
  userName: string;
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

  return {
    ...(userConfig as StrategyConfig),
    ...(symbolConfig as StrategyConfig),
    ENV: 'BACKTEST',
    MAKE_ORDERS: true,
    INTERVAL: interval,
  };
};

const warmReplayHistory = async ({
  userName,
  connectorName,
  targets,
}: {
  userName: string;
  connectorName: string;
  targets: ReplayTarget[];
}) => {
  const connectorFactory = await getConnectorCreatorByName(
    connectorName,
    projectRoot,
  );
  if (!connectorFactory) {
    throw new Error(`Connector "${connectorName}" is not registered`);
  }

  const connector = await (connectorFactory as ConnectorCreator)({ userName });
  const symbols = [...new Set(targets.map((target) => target.symbol))];

  await update(connector, interval, symbols, undefined, {
    connectorLabel: connectorName,
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
    });
  } else {
    logger.warn(
      'Coinbase connector is unavailable. BTC reference replay may drift.',
    );
  }
};

const formatPercent = (value: number | null) =>
  value == null || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(2)}%`;

const formatMinutes = (value: number | null) =>
  value == null || !Number.isFinite(value)
    ? 'n/a'
    : `${(value / 60_000).toFixed(2)}m`;

const formatEntryLabel = (entry: TradeParityEntry) =>
  `${entry.strategy} ${entry.symbol} ${entry.direction} ${formatUnix(entry.timestamp)}`;

const printEntryDetails = (label: string, entries: TradeParityEntry[]) => {
  if (!entries.length) {
    return;
  }

  console.log('');
  console.log(chalk.yellow(label));

  for (const entry of entries.slice(0, DETAIL_LIMIT)) {
    console.log(
      `- ${formatEntryLabel(entry)} price=${
        entry.price == null ? 'n/a' : entry.price.toFixed(6)
      } id=${entry.id}`,
    );
  }

  if (entries.length > DETAIL_LIMIT) {
    console.log(`- ... ${entries.length - DETAIL_LIMIT} more`);
  }
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

const classifyBacktestOnlyEntries = ({
  entries,
  runtimeSignals,
  toleranceMs,
}: {
  entries: TradeParityEntry[];
  runtimeSignals: Signal[];
  toleranceMs: number;
}): ClassifiedBacktestOnlyEntry[] =>
  entries.map((entry) => {
    const nearestSignal = findNearestRuntimeSignal({
      entry,
      runtimeSignals,
      toleranceMs,
    });

    if (!nearestSignal) {
      return {
        entry,
        classification: 'not_evaluated',
        reason: 'no_runtime_signal',
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

const summarizeBacktestOnlyClassifications = (
  classifiedEntries: ClassifiedBacktestOnlyEntry[],
) => {
  const counts = new Map<BacktestOnlyClassification, number>(
    BACKTEST_ONLY_CLASSIFICATIONS.map((classification) => [classification, 0]),
  );

  for (const item of classifiedEntries) {
    counts.set(item.classification, (counts.get(item.classification) ?? 0) + 1);
  }

  return BACKTEST_ONLY_CLASSIFICATIONS.map(
    (classification) => `${classification}=${counts.get(classification) ?? 0}`,
  ).join(', ');
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
    const signalSuffix = item.signal
      ? ` signalId=${item.signal.signalId} signalDrift=${formatMinutes(item.signalTimestampDiffMs ?? null)}`
      : '';

    console.log(
      `- [${item.classification}] ${formatEntryLabel(item.entry)} price=${
        item.entry.price == null ? 'n/a' : item.entry.price.toFixed(6)
      } id=${item.entry.id} reason=${item.reason}${signalSuffix}`,
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
  const rows = new Map<
    string,
    {
      runtime: number;
      runtimeDuplicates: number;
      backtest: number;
      matched: number;
      runtimeOnly: number;
      backtestOnly: number;
      targets: number;
      compared: number;
      errors: number;
    }
  >();

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
    const [allRuntimeTrades, allRuntimeSignals] = await Promise.all([
      loadRuntimeTrades(flags.user),
      loadRuntimeSignals(flags.user),
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

    const replayTargets = await buildReplayTargets({
      userName: flags.user,
      runtimeTrades,
      strategyFilter: String(flags.strategy || '').trim() || undefined,
      explicitSymbols: requestedSymbols,
    });

    if (!replayTargets.length) {
      console.log(
        chalk.yellow(
          `No replay targets found for ${flags.user} in ${formatUnix(window.start)} -> ${formatUnix(window.end)}.`,
        ),
      );
      return;
    }

    if (!flags.cacheOnly) {
      await warmReplayHistory({
        userName: flags.user,
        connectorName,
        targets: replayTargets,
      });
    }

    const backtestEntries: TradeParityEntry[] = [];
    const successfulTargetKeys = new Set<string>();
    const runtimeGateWarningCounts = new Map<string, number>();

    for (const target of replayTargets) {
      try {
        const replayConfig = await buildReplayConfig({
          userName: flags.user,
          strategy: target.strategy,
          symbol: target.symbol,
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
        successfulTargetKeys.add(toTargetKey(target));
      } catch (error) {
        replayErrors.push({
          ...target,
          message: (error as Error)?.message || String(error),
        });
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
      toleranceMs,
    });
    const summary = summarizeMatchedParity(comparison.matched);

    console.log(chalk.cyan('TradeJS runtime parity'));
    console.log(
      `Window: ${formatUnix(window.start)} -> ${formatUnix(window.end)} (${window.source})`,
    );
    console.log(`Connector: ${connectorName}`);
    console.log(
      `Tolerance: ${toleranceBars} bar(s) / ${(toleranceMs / 60_000).toFixed(0)}m`,
    );
    console.log(
      `Targets: ${replayTargets.length}, compared: ${successfulTargetKeys.size}, replayErrors: ${replayErrors.length}`,
    );
    console.log(
      `Target sources: runtime=${replayTargets.filter((target) => target.sources.includes('runtime')).length}, runtimeUniverse=${replayTargets.filter((target) => target.sources.includes('runtimeUniverse')).length}, explicitTickers=${replayTargets.filter((target) => target.sources.includes('explicitTickers')).length}, strategyResults=${replayTargets.filter((target) => target.sources.includes('strategyResults')).length}`,
    );
    console.log('');
    console.log(
      `Runtime entries: ${rawRuntimeEntries.length} (deduped: ${runtimeEntries.length}, duplicates: ${runtimeDedupe.duplicateEntries.length}), backtest entries: ${backtestEntries.length}, matched: ${comparison.matched.length}, runtimeOnly: ${comparison.runtimeOnly.length}, backtestOnly: ${comparison.backtestOnly.length}`,
    );
    console.log(
      `Matched price delta avg/max: ${formatPercent(summary.avgPriceDeltaPct)} / ${formatPercent(summary.maxPriceDeltaPct)}`,
    );
    console.log(
      `Matched timestamp drift avg/max: ${formatMinutes(summary.avgTimestampDiffMs)} / ${formatMinutes(summary.maxTimestampDiffMs)}`,
    );
    if (runtimeDedupe.duplicateGroups.length) {
      console.log(
        `Runtime duplicate groups: ${runtimeDedupe.duplicateGroups.length}, duplicate entries: ${runtimeDedupe.duplicateEntries.length}`,
      );
    }
    if (classifiedBacktestOnly.length) {
      console.log(
        `Backtest only classifications: ${summarizeBacktestOnlyClassifications(classifiedBacktestOnly)}`,
      );
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

    if (strategyRows.length) {
      console.log('');
      console.log(chalk.cyan('By strategy'));
      for (const [strategy, row] of strategyRows) {
        console.log(
          `- ${strategy}: targets=${row.targets}, compared=${row.compared}, errors=${row.errors}, runtime=${row.runtime}, runtimeDuplicates=${row.runtimeDuplicates}, backtest=${row.backtest}, matched=${row.matched}, runtimeOnly=${row.runtimeOnly}, backtestOnly=${row.backtestOnly}`,
        );
      }
    }

    if (runtimeGateWarningCounts.size) {
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
      printEntryDetails('Runtime only', comparison.runtimeOnly);
      printClassifiedBacktestOnlyDetails(classifiedBacktestOnly);
    }
  } finally {
    resetTestingKlineCache(projectRoot);
  }
};

if (process.env.NODE_ENV !== 'test') {
  runtimeParity()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
