import 'dotenv/config';
import args from 'args';
import ProgressBar from 'progress';
import _ from 'lodash';
import chalk from 'chalk';
import {
  getConnectorCreatorByName,
  resolveConnectorName,
  DEFAULT_CONNECTOR_NAME,
} from '@tradejs/node/connectors';
import {
  getTickers,
  loadTradejsConfig,
  makeScreenshots,
  sendRuntimeCloseNotificationsToTG,
  sendTextToTG,
  sendToTG,
} from '@tradejs/node/cli';
import { runWithConcurrency } from '@tradejs/core/async';
import { releaseStrategyReplayCache } from '@tradejs/core/strategies';
import type {
  TradejsConfigAfterSignalsHookContext,
  TradejsConfigHooks,
} from '@tradejs/core/config';
import { SIGNALS_CLI_PRELOAD_DAYS } from '@tradejs/core/constants';
import { enrichSignalWithBinanceMarketContext } from '@tradejs/node/strategies';
import { getTimestamp } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import { redisKeys, setData, setHashJsonField } from '@tradejs/infra/redis';
import {
  getRuntimeDeployment,
  saveRuntimeDeploymentHeartbeat,
} from '@tradejs/infra/tradingAccounts';
import {
  Connector,
  ConnectorCreator,
  InstrumentDescriptor,
  Interval,
  MarketUniverse,
  RuntimeDeployment,
  RuntimeStrategyCloseNotification,
  Signal,
} from '@tradejs/types';
import {
  getRuntimeSignalRetentionTtlSeconds,
  getRuntimeStorageDayKey,
  toStoredRuntimeSignal,
  toRuntimeSignalBucketRef,
} from '../lib/runtimeSignalsStorage';
import {
  alignSymbolWithBtcReference,
  getClosedCandlesForInterval,
} from '../lib/marketData/windows';
import { timeOperation as runTimedOperation } from '../lib/runFormatting';
import {
  invokeAfterSignalsHooks,
  invokeBeforeSignalsHooks,
} from '../lib/signals/hooks';
import { prepareMarketContextForRun } from '../lib/marketContextPrepare';
import {
  loadBtcReferenceConnectors,
  updateBtcReferenceHistory,
  updateMarketHistoryWithBtcReferences,
  updatePrimaryMarketHistory,
} from '../lib/marketData/historyPrepare';
import {
  loadRuntimeStrategies,
  type StrategyRuntimeConfig,
} from '../lib/signals/runtimeStrategies';
import {
  createStrategySkipStats,
  logStrategySkipStats,
  recordStrategyReason,
  type StrategySkipStatsMap,
} from '../lib/signals/skipStats';
import {
  buildRuntimeSignalEvaluationId,
  saveRuntimeSignalEvaluation,
} from '../lib/signals/evaluations';
import { getTelegramDeliverableSignals } from '../lib/signals/telegram';
import { buildRuntimeModeStrategyConfig } from '../lib/runtimeModeConfig';
import {
  buildSignalsStrategyLifecycleKey,
  createSignalsStrategyLifecycle,
  type SignalsStrategyLifecycle,
} from '../lib/signals/runtimeLifecycle';
import {
  getSignalsHeartbeatStatus,
  runSignalsDaemon,
} from '../lib/signals/daemon';
import {
  createSignalsKlineFeed,
  type SignalsKlineFeed,
} from '../lib/signals/klineFeed';

args.option(['t', 'tickers'], 'Selected tickers');
args.option(['e', 'exclude'], 'Exclude tickers from tests');
args.option(['l', 'tickersLimit'], 'Tickers limit');
args.option(['f', 'timeframe'], 'Timeframe', 15);
args.option(['m', 'makeOrders'], 'Make orders');
args.option(['N', 'notify'], 'Send message in Telegram', false);
args.option(['S', 'skipScreenshots'], 'Skip screenshot generation', false);
args.option(['u', 'updateOnly'], 'Only update tickers history', false);
args.option(['C', 'cacheOnly'], 'Do not update tickers history', false);
args.option(['L', 'showTickersList'], 'Just show only ticker list', false);
args.option(
  ['p', 'parallel'],
  'Signal evaluation worker count',
  Number(process.env.SIGNALS_PARALLEL || 4),
);
args.option(
  ['R', 'showSkipStats'],
  'Show aggregated skip stats by strategy',
  false,
);
args.option(['c', 'chunk'], 'Split by chunks, ex. 1/3');
args.option(['U', 'user'], 'Use user confg', 'root');
args.option(['w', 'watch'], 'Keep signals running on candle boundaries', false);
args.option(
  ['d', 'settleDelayMs'],
  'Delay after candle close before a daemon cycle',
  Number(process.env.SIGNALS_DAEMON_SETTLE_DELAY_MS || 5_000),
);
args.option(
  ['o', 'connector'],
  'Connector provider or name for signals (e.g. bybit, binance, coinbase, custom)',
  'bybit',
);
args.option(['V', 'universe'], 'Market universe (crypto or tradfi)', 'crypto');
args.option(['A', 'account'], 'Trading account id');
args.option(['D', 'deployment'], 'Runtime deployment id');

const SLOW_SIGNALS_WARNING_MS = 10 * 60_000;
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

const flags = args.parse(process.argv);
const interval = flags.timeframe.toString() as Interval;
const intervalMs = Number(interval) * 60_000;

export interface SignalsSession {
  connectorName: string;
  universe: MarketUniverse;
  accountId?: string;
  interval: Interval;
  intervalMs: number;
  deployment?: RuntimeDeployment | null;
  startedAt: number;
  marketConnector: Connector;
  btcReferences: Awaited<ReturnType<typeof loadBtcReferenceConnectors>>;
  lifecycle: SignalsStrategyLifecycle;
  klineFeed?: SignalsKlineFeed;
}

const formatDuration = (durationMs: number) =>
  `${(durationMs / 1000).toFixed(1)}s`;

const resolvePositiveInteger = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : fallback;
};

const resolveNonNegativeInteger = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
};

const resolveSignalsDaemonMaxLiveBars = (runtimeInterval = interval) => {
  const intervalMinutes = Number(runtimeInterval);
  const preloadBars = Math.ceil(
    (SIGNALS_CLI_PRELOAD_DAYS * 24 * 60) / intervalMinutes,
  );
  return resolvePositiveInteger(
    process.env.SIGNALS_DAEMON_MAX_LIVE_BARS,
    preloadBars,
  );
};

const isSignalsKlineWsEnabled = () =>
  !['0', 'false', 'off', 'no'].includes(
    String(process.env.SIGNALS_KLINE_WS_ENABLED ?? 'true')
      .trim()
      .toLowerCase(),
  );

const resolveSignalsKlineWsWaitMs = () =>
  resolveNonNegativeInteger(process.env.SIGNALS_KLINE_WS_WAIT_MS, 10_000);

const createDefaultSignalsLifecycle = (runtimeInterval = interval) =>
  createSignalsStrategyLifecycle({
    intervalMs: Number(runtimeInterval) * 60_000,
    maxLiveBars: resolveSignalsDaemonMaxLiveBars(runtimeInterval),
    releaseState: releaseStrategyReplayCache,
  });

const timeOperation = <T>(label: string, operation: () => Promise<T>) =>
  runTimedOperation(label, operation, (message) =>
    logger.info(chalk.gray(message)),
  );

const formatSlowSignalsWarning = (params: {
  durationMs: number;
  status: 'completed' | 'failed';
  found: number;
}) =>
  [
    '<b>Slow yarn signals run</b>',
    `Duration: <b>${formatDuration(params.durationMs)}</b>`,
    `Threshold: <b>${formatDuration(SLOW_SIGNALS_WARNING_MS)}</b>`,
    `Status: <b>${params.status}</b>`,
    `Found signals: <b>${params.found}</b>`,
  ].join('\n');

const resolveSignalsConnectorName = async (value: unknown): Promise<string> => {
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

export const createSignalsSession = async (
  lifecycle: SignalsStrategyLifecycle,
  scope: {
    interval?: Interval;
    universe?: MarketUniverse;
    accountId?: string;
    connectorName?: string;
  } = {},
): Promise<SignalsSession> => {
  const deployment = flags.deployment
    ? await getRuntimeDeployment(flags.user, String(flags.deployment))
    : null;
  if (flags.deployment && !deployment) {
    throw new Error(`Runtime deployment not found: ${flags.deployment}`);
  }
  if (deployment && !deployment.enabled) {
    throw new Error(`Runtime deployment is disabled: ${deployment.id}`);
  }
  const requestedRuntimeInterval = (scope.interval ?? interval) as Interval;
  const runtimeInterval = (deployment?.interval ??
    requestedRuntimeInterval) as Interval;
  const runtimeIntervalMs = Number(runtimeInterval) * 60_000;
  if (!Number.isFinite(runtimeIntervalMs) || runtimeIntervalMs <= 0) {
    throw new Error(`Invalid runtime timeframe: ${runtimeInterval}`);
  }
  if (
    deployment &&
    String(deployment.interval) !== String(requestedRuntimeInterval)
  ) {
    throw new Error(
      `Deployment ${deployment.id} requires timeframe ${deployment.interval}; received ${requestedRuntimeInterval}`,
    );
  }
  const connectorName = await resolveSignalsConnectorName(
    deployment?.connectorName ?? scope.connectorName ?? flags.connector,
  );
  const universe = (deployment?.universe ??
    scope.universe ??
    flags.universe) as MarketUniverse;
  const requestedAccountId =
    deployment?.accountId ?? scope.accountId ?? flags.account;
  const connectorFactory = await getConnectorCreatorByName(
    connectorName,
    projectRoot,
  );
  if (!connectorFactory) {
    throw new Error(`Connector "${connectorName}" is not registered`);
  }
  const marketConnector = await (connectorFactory as ConnectorCreator)({
    userName: flags.user,
    universe,
    accountId: requestedAccountId,
    deploymentId: deployment?.id,
  });
  const btcReferences = await loadBtcReferenceConnectors({
    connectorName,
    marketConnector,
    userName: flags.user,
    projectRoot,
    shouldUseDedicatedReferences:
      universe === 'crypto' &&
      connectorName.toLowerCase() === DEFAULT_CONNECTOR_NAME.toLowerCase(),
    warn: (message) => logger.warn(message),
  });

  return {
    connectorName,
    universe,
    accountId: marketConnector.accountId ?? requestedAccountId,
    interval: runtimeInterval,
    intervalMs: runtimeIntervalMs,
    deployment,
    startedAt: Date.now(),
    marketConnector,
    btcReferences,
    lifecycle,
  };
};

const findSignals = async (
  symbol: string,
  connectorName: string,
  connector: Connector,
  btcBinanceData: Awaited<ReturnType<Connector['kline']>>,
  btcCoinbaseData: Awaited<ReturnType<Connector['kline']>>,
  runtimeStrategies: StrategyRuntimeConfig[],
  strategyStats: StrategySkipStatsMap,
  runtimeCloseNotifications: RuntimeStrategyCloseNotification[],
  lifecycle: SignalsStrategyLifecycle,
  preloadStart: number,
  currentTimestamp: number,
  persistStrategyState: boolean,
  universe: MarketUniverse,
  interval: Interval,
  intervalMs: number,
  accountId?: string,
  deploymentId?: string,
  instrument?: InstrumentDescriptor,
  runtimeScopeUniverse?: MarketUniverse,
): Promise<Signal[]> => {
  const strategySignals: Signal[] = [];

  const loadCached = (cachedSymbol: string) =>
    connector.kline({
      symbol: cachedSymbol,
      start: preloadStart,
      end: currentTimestamp,
      cacheOnly: true,
      interval,
    });
  const [cachedData, btcCachedData, ethCachedData] =
    universe === 'crypto'
      ? await Promise.all([
          loadCached(symbol),
          loadCached('BTCUSDT'),
          loadCached('ETHUSDT'),
        ])
      : [await loadCached(symbol), [], []];

  // Runtime evaluates only on the last closed candle. Timestamp filtering keeps
  // cache-only runs from accidentally stepping one closed bar back when the
  // newest forming bar is absent from Timescale.
  const closedData = getClosedCandlesForInterval(
    cachedData,
    currentTimestamp,
    intervalMs,
  );
  const closedBtcData = getClosedCandlesForInterval(
    btcCachedData,
    currentTimestamp,
    intervalMs,
  );
  const closedEthData = getClosedCandlesForInterval(
    ethCachedData,
    currentTimestamp,
    intervalMs,
  );
  const { alignedCoinCandles, alignedBtcCandles } =
    universe === 'crypto'
      ? alignSymbolWithBtcReference(closedData, closedBtcData)
      : { alignedCoinCandles: closedData, alignedBtcCandles: closedData };
  const ethByTimestamp = new Map(
    closedEthData.map((candle) => [candle.timestamp, candle]),
  );
  const alignedEthCandles = alignedCoinCandles
    .map((candle) => ethByTimestamp.get(candle.timestamp))
    .filter((candle): candle is (typeof closedEthData)[number] =>
      Boolean(candle),
    );
  const lastCandle = alignedCoinCandles.at(-1);
  const btcLastCandle = alignedBtcCandles.at(-1);
  const ethLastCandle =
    lastCandle == null ? undefined : ethByTimestamp.get(lastCandle.timestamp);

  if (!lastCandle || !btcLastCandle) {
    return strategySignals;
  }
  const previousData = alignedCoinCandles.slice(0, -1);
  const previousBtcData = alignedBtcCandles.slice(0, -1);
  const previousEthData = alignedEthCandles.filter(
    (candle) => candle.timestamp < lastCandle.timestamp,
  );

  for (const runtimeStrategy of runtimeStrategies) {
    const {
      strategyName,
      configId,
      strategyCreator,
      strategyConfig,
      strategyResults,
    } = runtimeStrategy;
    const runtimeConfig = buildRuntimeModeStrategyConfig({
      strategyConfig,
      env: 'CRON',
      interval,
      makeOrders: flags.makeOrders,
    });
    const lifecycleKey = buildSignalsStrategyLifecycleKey({
      connectorName,
      universe: runtimeScopeUniverse,
      accountId,
      deploymentId,
      symbol,
      interval,
      strategyName,
      configId,
    });
    const stats = strategyStats.get(strategyName);
    const evaluation = await lifecycle.evaluate({
      key: lifecycleKey,
      timestamp: lastCandle.timestamp,
      config: {
        runtimeConfig,
        symbolResultConfig: strategyResults?.[symbol]?.config ?? null,
      },
      btcBinanceData,
      btcCoinbaseData,
      onRuntimeClose: (event) => {
        runtimeCloseNotifications.push(event);
      },
      create: async ({
        btcBinanceData: lifecycleBtcBinanceData,
        btcCoinbaseData: lifecycleBtcCoinbaseData,
        onRuntimeClose,
      }) =>
        strategyCreator({
          userName: flags.user,
          connectorName,
          runtimeConfigId: configId,
          connector,
          symbol,
          ...(runtimeScopeUniverse
            ? {
                universe,
                assetClass: instrument?.assetClass,
                instrument,
                accountId,
                deploymentId,
              }
            : {}),
          data: [...previousData],
          btcData: universe === 'crypto' ? [...previousBtcData] : [],
          ethData: universe === 'crypto' ? [...previousEthData] : [],
          btcBinanceData: lifecycleBtcBinanceData,
          btcCoinbaseData: lifecycleBtcCoinbaseData,
          config: runtimeConfig,
          ...(persistStrategyState
            ? { sharedStrategyStateKey: lifecycleKey }
            : {}),
          onRuntimeClose,
        }),
      run: (strategy) => strategy(lastCandle, btcLastCandle, ethLastCandle),
    });

    if (evaluation.action === 'duplicate' || evaluation.action === 'stale') {
      continue;
    }
    if (evaluation.action.startsWith('rebuilt_')) {
      logger.info(
        'Rebuilt signals strategy state (%s): %s %s',
        evaluation.action.slice('rebuilt_'.length),
        strategyName,
        symbol,
      );
    }
    if (stats) {
      stats.evaluated += 1;
    }

    const signal = evaluation.result;
    if (!signal || typeof signal === 'string') {
      const reason =
        typeof signal === 'string' && signal.trim() ? signal : 'NO_SIGNAL';
      if (typeof signal === 'string') {
        recordStrategyReason(strategyStats, strategyName, signal, 'core');
      }
      await saveRuntimeSignalEvaluation({
        evaluationId: buildRuntimeSignalEvaluationId({
          strategyName,
          symbol,
          timestamp: lastCandle.timestamp,
          runtimeConfigId: configId,
        }),
        userName: flags.user,
        strategy: strategyName,
        runtimeConfigId: configId,
        symbol,
        interval,
        universe,
        assetClass: instrument?.assetClass,
        accountId,
        deploymentId,
        policyProfileId: runtimeConfig.POLICY_PROFILE_ID,
        timestamp: lastCandle.timestamp,
        evaluatedAt: Date.now(),
        status: 'skip',
        reason,
      });
      continue;
    }

    if (stats) {
      stats.signals += 1;
    }
    signal.runtimeConfigId = configId;
    if (
      configId &&
      configId !== 'config' &&
      !signal.signalId.endsWith(`:${configId}`)
    ) {
      signal.signalId = `${signal.signalId}:${configId}`;
    }
    await enrichSignalWithBinanceMarketContext({
      signal,
      env: 'CRON',
    });
    if (
      signal.orderStatus === 'skipped' &&
      typeof signal.orderSkipReason === 'string' &&
      signal.orderSkipReason.trim()
    ) {
      recordStrategyReason(
        strategyStats,
        strategyName,
        signal.orderSkipReason,
        'runtime',
      );
    }
    strategySignals.push(signal);
    const runtimeSignalRetentionTtl = getRuntimeSignalRetentionTtlSeconds();

    await setData(
      redisKeys.storeSignal(symbol, signal.signalId),
      toStoredRuntimeSignal(signal),
      {
        expire: runtimeSignalRetentionTtl,
      },
    );

    await setHashJsonField(
      redisKeys.runtimeSignalBucket(
        flags.user,
        getRuntimeStorageDayKey(signal.timestamp),
        signal.strategy,
      ),
      signal.signalId,
      toRuntimeSignalBucketRef(signal),
      {
        expire: runtimeSignalRetentionTtl,
      },
    );

    await saveRuntimeSignalEvaluation({
      evaluationId: buildRuntimeSignalEvaluationId({
        strategyName,
        symbol,
        timestamp: lastCandle.timestamp,
        runtimeConfigId: configId,
      }),
      userName: flags.user,
      strategy: strategyName,
      runtimeConfigId: configId,
      symbol,
      interval,
      universe,
      assetClass: instrument?.assetClass,
      accountId,
      deploymentId,
      policyProfileId: signal.policyProfileId,
      timestamp: lastCandle.timestamp,
      evaluatedAt: Date.now(),
      status: 'signal',
      reason: signal.orderSkipReason || signal.orderStatus || 'SIGNAL',
      signalId: signal.signalId,
      direction: signal.direction,
      orderStatus: signal.orderStatus,
      orderSkipReason: signal.orderSkipReason,
      ...(signal.aiAnalysis ? { aiAnalysis: signal.aiAnalysis } : {}),
      ...(signal.ml ? { ml: signal.ml } : {}),
    });

    logger.info('Signal found %s by strategy %s', symbol, strategyName);
  }

  return strategySignals;
};

export const signals = async (options: { session?: SignalsSession } = {}) => {
  const startedAt = Date.now();
  const signals = new Array<Signal>();
  const runtimeCloseNotifications =
    new Array<RuntimeStrategyCloseNotification>();
  let status: 'completed' | 'failed' = 'completed';
  let failureMessage: string | undefined;
  let activeSession: SignalsSession | undefined;
  let projectHooks: TradejsConfigHooks | undefined;
  let afterSignalsHookContext: Omit<
    TradejsConfigAfterSignalsHookContext,
    'signals' | 'status' | 'durationMs'
  > | null = null;

  try {
    const session =
      options.session ??
      (await createSignalsSession(createDefaultSignalsLifecycle()));
    activeSession = session;
    const persistStrategyState = options.session != null;
    const {
      connectorName,
      universe: sessionUniverse,
      accountId,
      deployment,
      marketConnector,
      btcReferences,
      lifecycle,
      interval,
      intervalMs,
    } = session;
    const universe =
      sessionUniverse ?? marketConnector.universe ?? ('crypto' as const);

    const tickers = await timeOperation('tickers load', () => {
      const baseArgs = [
        marketConnector,
        flags.tickers || deployment?.tickers?.join(','),
        flags.exclude,
        flags.tickersLimit,
        flags.chunk,
      ] as const;
      return sessionUniverse || accountId || deployment
        ? getTickers(...baseArgs, {
            universe,
            assetClasses: deployment?.assetClasses,
          })
        : getTickers(...baseArgs);
    });
    if (
      universe === 'tradfi' &&
      typeof marketConnector.listInstruments !== 'function'
    ) {
      throw new Error('TradFi connector must implement listInstruments');
    }
    const instruments =
      typeof marketConnector.listInstruments === 'function'
        ? await marketConnector.listInstruments({
            universe,
            assetClasses: deployment?.assetClasses,
            symbols: tickers,
          })
        : [];
    const instrumentsBySymbol = new Map(
      instruments.map((instrument) => [instrument.symbol, instrument]),
    );

    if (flags.showTickersList) {
      console.log(chalk.gray(JSON.stringify(tickers.sort(), null, 2)));

      return;
    }

    const projectConfig = await loadTradejsConfig(projectRoot);
    projectHooks = projectConfig.hooks;

    const currentTimestamp = getTimestamp();
    const preloadStart = getTimestamp(SIGNALS_CLI_PRELOAD_DAYS);

    if (!flags.cacheOnly && session.klineFeed) {
      const expectedSymbols =
        universe === 'crypto'
          ? [...new Set([...tickers, 'BTCUSDT', 'ETHUSDT'])]
          : tickers;
      session.klineFeed.setSubscriptions(expectedSymbols);
      const targetTimestamp =
        Math.floor(currentTimestamp / intervalMs) * intervalMs - intervalMs;
      const missingSymbols = await timeOperation(
        'websocket candle readiness',
        () =>
          session.klineFeed!.waitForClosed({
            symbols: expectedSymbols,
            timestamp: targetTimestamp,
            timeoutMs: resolveSignalsKlineWsWaitMs(),
          }),
      );
      await session.klineFeed.flush();
      logger.info(
        chalk.gray(
          `websocket candles: ready=${expectedSymbols.length - missingSymbols.length}/${expectedSymbols.length} missing=${missingSymbols.length}`,
        ),
      );
      await updatePrimaryMarketHistory({
        marketConnector,
        connectorName,
        interval,
        symbols: missingSymbols,
        preloadDays: SIGNALS_CLI_PRELOAD_DAYS,
        universe,
        log: (message) => logger.info(chalk.gray(message)),
      });
      await updateBtcReferenceHistory({
        marketConnector,
        btcReferences,
        interval,
        preloadDays: SIGNALS_CLI_PRELOAD_DAYS,
        universe,
        log: (message) => logger.info(chalk.gray(message)),
      });
    } else if (!flags.cacheOnly) {
      await updateMarketHistoryWithBtcReferences({
        marketConnector,
        connectorName,
        btcReferences,
        interval,
        symbols: tickers,
        preloadDays: SIGNALS_CLI_PRELOAD_DAYS,
        universe,
        log: (message) => logger.info(chalk.gray(message)),
      });
    }

    await prepareMarketContextForRun({
      mode: 'signals',
      userName: flags.user,
      projectRoot,
      symbols: tickers,
      universe,
      interval,
      startMs: currentTimestamp,
      endMs: currentTimestamp,
      preloadStartMs: preloadStart,
      cacheOnly: Boolean(flags.cacheOnly),
      log: (message) => logger.info(chalk.gray(message)),
    });

    if (flags.updateOnly) {
      return;
    }

    const [btcBinanceData, btcCoinbaseData] =
      universe === 'crypto'
        ? await timeOperation('reference candles load', () =>
            Promise.all([
              btcReferences.binance.kline({
                symbol: 'BTCUSDT',
                start: preloadStart,
                end: currentTimestamp,
                cacheOnly: true,
                interval,
              }),
              btcReferences.coinbase.kline({
                symbol: 'BTCUSDT',
                start: preloadStart,
                end: currentTimestamp,
                cacheOnly: true,
                interval,
              }),
            ]),
          )
        : [[], []];

    const runtimeStrategies = await loadRuntimeStrategies({
      userName: flags.user,
      projectRoot,
      deployment,
      connectorName,
      universe,
      accountId,
      interval,
    });
    if (!runtimeStrategies.length) {
      lifecycle.clear();
      logger.warn(
        'No strategy configs found by users:%s:strategies:*:config',
        flags.user,
      );
      return;
    }
    lifecycle.retain(
      new Set(
        tickers.flatMap((symbol) =>
          runtimeStrategies.map(({ strategyName, configId }) =>
            buildSignalsStrategyLifecycleKey({
              connectorName,
              universe: sessionUniverse,
              accountId,
              deploymentId: deployment?.id,
              symbol,
              interval,
              strategyName,
              configId,
            }),
          ),
        ),
      ),
    );
    logger.info(
      chalk.yellow(
        `loaded strategies (user=${flags.user}): ${runtimeStrategies.map((s) => s.strategyName).join(', ')}`,
      ),
    );
    afterSignalsHookContext = {
      connector: marketConnector,
      connectorName,
      userName: flags.user,
      interval,
      tickers: [...tickers],
      runtimeStrategies: runtimeStrategies.map(
        ({ strategyName, strategyConfig }) => ({
          strategyName,
          strategyConfig,
        }),
      ),
    };

    const beforeSignalsResult = await invokeBeforeSignalsHooks(
      projectHooks,
      afterSignalsHookContext,
    );
    if (beforeSignalsResult?.abort === true) {
      logger.info(
        'signals aborted before ticker evaluation: %s',
        beforeSignalsResult.reason ?? 'PROJECT_BEFORE_SIGNALS_ABORTED',
      );
      return;
    }

    const strategyStats = createStrategySkipStats(runtimeStrategies);

    const bar = new ProgressBar(
      ':current/:total [:bar][:percent] :found :eta(s) :symbol',
      {
        total: tickers.length,
        width: 30,
      },
    );

    logger.info(chalk.yellow(`tickers: ${tickers.length}`));
    const signalsParallel = resolvePositiveInteger(flags.parallel, 4);
    logger.info(chalk.yellow(`signal workers: ${signalsParallel}`));

    await timeOperation('strategy evaluation', async () => {
      await runWithConcurrency(tickers, signalsParallel, async (symbol) => {
        const strategySignals = await findSignals(
          symbol,
          connectorName,
          marketConnector,
          btcBinanceData,
          btcCoinbaseData,
          runtimeStrategies,
          strategyStats,
          runtimeCloseNotifications,
          lifecycle,
          preloadStart,
          currentTimestamp,
          persistStrategyState,
          universe,
          interval,
          intervalMs,
          accountId,
          deployment?.id,
          instrumentsBySymbol.get(symbol),
          sessionUniverse,
        );

        if (strategySignals.length > 0) {
          signals.push(...strategySignals);
        }

        bar.tick(1, {
          found: chalk.cyan(signals.length),
          symbol: chalk.gray(symbol),
        });
      });
    });

    if (flags.notify) {
      const telegramSignals = getTelegramDeliverableSignals(signals);

      if (!flags.skipScreenshots && telegramSignals.length > 0) {
        await makeScreenshots(telegramSignals, interval, flags.user);
      }

      await sendToTG(telegramSignals, interval, flags.user);
      await sendRuntimeCloseNotificationsToTG(
        runtimeCloseNotifications,
        flags.user,
      );
    }

    logger.info(
      JSON.stringify(
        signals.map((s) => s.symbol),
        null,
        2,
      ),
    );

    if (flags.showSkipStats) {
      logStrategySkipStats(runtimeStrategies, strategyStats);
    }
  } catch (error) {
    status = 'failed';
    failureMessage = (error as Error)?.message || String(error);
    logger.error(
      'signals failed: %s',
      (error as Error)?.message || String(error),
    );
    throw error;
  } finally {
    const durationMs = Date.now() - startedAt;

    if (activeSession?.deployment) {
      await saveRuntimeDeploymentHeartbeat(flags.user, {
        deploymentId: activeSession.deployment.id,
        status: getSignalsHeartbeatStatus({
          cycleStatus: status,
          continuous: options.session != null || Boolean(flags.watch),
        }),
        pid: process.pid,
        startedAt: activeSession.startedAt,
        lastCycleAt: Date.now(),
        ...(failureMessage ? { lastError: failureMessage } : {}),
      });
    }

    if (projectHooks && afterSignalsHookContext) {
      try {
        await invokeAfterSignalsHooks(projectHooks, {
          ...afterSignalsHookContext,
          signals: [...signals],
          status,
          durationMs,
        });
      } catch (error) {
        logger.error(
          'afterSignals hook failed: %s',
          (error as Error)?.message || String(error),
        );
      }
    }

    if (flags.notify && durationMs > SLOW_SIGNALS_WARNING_MS) {
      try {
        await sendTextToTG(
          formatSlowSignalsWarning({
            durationMs,
            status,
            found: signals.length,
          }),
          { userName: flags.user },
        );
      } catch (error) {
        logger.error(
          'slow signals warning failed: %s',
          (error as Error)?.message || String(error),
        );
      }
    }

    logger.info(
      chalk.yellow(
        `signals ${status} in ${formatDuration(durationMs)} (found=${signals.length})`,
      ),
    );
    logger.info('');
    logger.info('');
    logger.info('');
  }
};

type ConfiguredSignalsScope = {
  connectorName: string;
  universe: MarketUniverse;
  accountId?: string;
  interval: Interval;
};

const loadConfiguredSignalsScopes = async (
  deployment?: RuntimeDeployment | null,
) => {
  const configuredStrategies = await loadRuntimeStrategies({
    userName: flags.user,
    projectRoot,
    deployment,
    connectorName: String(flags.connector),
  });
  const connectorName = await resolveSignalsConnectorName(
    deployment?.connectorName ?? flags.connector,
  );
  const scopes = new Map<string, ConfiguredSignalsScope>();
  for (const strategy of configuredStrategies) {
    const key = [
      connectorName,
      strategy.universe,
      strategy.accountId ?? 'default',
      strategy.interval,
    ].join(':');
    scopes.set(key, {
      connectorName,
      universe: strategy.universe,
      accountId: strategy.accountId,
      interval: strategy.interval,
    });
  }
  return scopes;
};

const hasExplicitSignalsScope = () =>
  process.argv.some((argument) =>
    [
      '-f',
      '--timeframe',
      '-V',
      '--universe',
      '-A',
      '--account',
      '-D',
      '--deployment',
    ].some(
      (option) => argument === option || argument.startsWith(`${option}=`),
    ),
  );

export const signalsConfiguredScopesOnce = async () => {
  if (
    flags.updateOnly ||
    flags.showTickersList ||
    flags.deployment ||
    hasExplicitSignalsScope()
  ) {
    return signals();
  }
  const scopes = await loadConfiguredSignalsScopes();
  if (!scopes.size) return signals();
  for (const scope of scopes.values()) {
    const session = await createSignalsSession(
      createDefaultSignalsLifecycle(scope.interval),
      scope,
    );
    try {
      await signals({ session });
    } finally {
      await session.klineFeed?.close();
      session.lifecycle.clear();
    }
  }
};

export const signalsDaemon = async () => {
  if (flags.updateOnly || flags.showTickersList) {
    throw new Error(
      'Signals daemon does not support updateOnly or showTickersList mode',
    );
  }

  const abortController = new AbortController();
  const daemonDeployment = flags.deployment
    ? await getRuntimeDeployment(flags.user, String(flags.deployment))
    : null;
  if (flags.deployment && !daemonDeployment) {
    throw new Error(`Runtime deployment not found: ${flags.deployment}`);
  }
  const sessions = new Map<string, SignalsSession>();
  const lastBoundaryByScope = new Map<string, number>();
  const stop = (signalName: string) => {
    logger.info('signals daemon stopping by %s', signalName);
    abortController.abort();
  };
  const stopOnSigint = () => stop('SIGINT');
  const stopOnSigterm = () => stop('SIGTERM');
  process.once('SIGINT', stopOnSigint);
  process.once('SIGTERM', stopOnSigterm);

  logger.info(
    'signals daemon started (config-driven scopes, fallback interval=%s)',
    interval,
  );
  try {
    await runSignalsDaemon({
      intervalMs: 60_000,
      settleDelayMs: resolveNonNegativeInteger(flags.settleDelayMs, 5_000),
      signal: abortController.signal,
      runCycle: async () => {
        const scopes = await loadConfiguredSignalsScopes(daemonDeployment);

        for (const [key, staleSession] of sessions) {
          if (scopes.has(key)) continue;
          await staleSession.klineFeed?.close();
          staleSession.lifecycle.clear();
          sessions.delete(key);
          lastBoundaryByScope.delete(key);
        }

        for (const [key, scope] of scopes) {
          const scopeIntervalMs = Number(scope.interval) * 60_000;
          const boundary =
            Math.floor(Date.now() / scopeIntervalMs) * scopeIntervalMs;
          if (lastBoundaryByScope.get(key) === boundary) continue;
          let session = sessions.get(key);
          if (!session) {
            session = await createSignalsSession(
              createDefaultSignalsLifecycle(scope.interval),
              scope,
            );
            sessions.set(key, session);
          }
          if (
            !session.klineFeed &&
            isSignalsKlineWsEnabled() &&
            session.connectorName.toLowerCase() === 'bybit'
          ) {
            session.klineFeed = await createSignalsKlineFeed({
              config: {
                userName: flags.user,
                universe: session.universe,
                accountId: session.accountId,
                deploymentId: session.deployment?.id,
              },
              interval: session.interval,
              universe: session.universe,
            });
            logger.info(
              'Bybit websocket candle feed enabled (account=%s, universe=%s, interval=%s)',
              session.accountId ?? 'default',
              session.universe,
              session.interval,
            );
          }
          try {
            await signals({ session });
            lastBoundaryByScope.set(key, boundary);
          } catch (error) {
            await session.klineFeed?.close();
            session.lifecycle.clear();
            sessions.delete(key);
            throw error;
          }
        }
        const memory = process.memoryUsage();
        const stateKeys = [...sessions.values()].reduce(
          (sum, session) => sum + session.lifecycle.size(),
          0,
        );
        logger.info(
          'signals daemon resources: rss=%sMB heapUsed=%sMB heapTotal=%sMB stateKeys=%s scopes=%s',
          (memory.rss / 1024 / 1024).toFixed(1),
          (memory.heapUsed / 1024 / 1024).toFixed(1),
          (memory.heapTotal / 1024 / 1024).toFixed(1),
          stateKeys,
          sessions.size,
        );
      },
      onCycleError: (error) => {
        logger.error(
          'signals daemon cycle failed: %s',
          (error as Error)?.message || String(error),
        );
      },
    });
  } finally {
    process.removeListener('SIGINT', stopOnSigint);
    process.removeListener('SIGTERM', stopOnSigterm);
    for (const session of sessions.values()) {
      await session.klineFeed?.close();
      session.lifecycle.clear();
      if (session.deployment) {
        await saveRuntimeDeploymentHeartbeat(flags.user, {
          deploymentId: session.deployment.id,
          status: 'stopped',
          pid: process.pid,
          startedAt: session.startedAt,
          lastCycleAt: Date.now(),
        });
      }
    }
  }
};

export const main = () =>
  flags.watch ? signalsDaemon() : signalsConfiguredScopesOnce();
