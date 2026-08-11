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
import {
  getRuntimeDeployment,
  saveRuntimeDeploymentHeartbeat,
} from '@tradejs/infra/runtimeDeployments';
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
  alignSymbolWithBtcReference,
  getClosedCandlesForInterval,
} from '../marketData/windows';
import { timeOperation as runTimedOperation } from '../runFormatting';
import { invokeAfterSignalsHooks, invokeBeforeSignalsHooks } from './hooks';
import { prepareMarketContextForRun } from '../marketContextPrepare';
import {
  loadBtcReferenceConnectors,
  updateBtcReferenceHistory,
  updateMarketHistoryWithBtcReferences,
  updatePrimaryMarketHistory,
} from '../marketData/historyPrepare';
import {
  loadRuntimeStrategies,
  type StrategyRuntimeConfig,
} from './runtimeStrategies';
import {
  createStrategySkipStats,
  logStrategySkipStats,
  recordStrategyReason,
  type StrategySkipStatsMap,
} from './skipStats';
import {
  buildRuntimeSignalEvaluationId,
  createRuntimeSignalEvaluationBuffer,
} from './evaluations';
import { getTelegramDeliverableSignals } from './telegram';
import { buildRuntimeModeStrategyConfig } from '../runtimeModeConfig';
import { buildRuntimeLineage } from '../runtimeLineage';
import {
  buildSignalsStrategyLifecycleKey,
  createSignalsStrategyLifecycle,
  type SignalsStrategyLifecycle,
} from './runtimeLifecycle';
import { getSignalsHeartbeatStatus, runSignalsDaemon } from './daemon';
import { createSignalsKlineFeed, type SignalsKlineFeed } from './klineFeed';

const SLOW_SIGNALS_WARNING_MS = 10 * 60_000;

export interface SignalsRunnerConfig {
  projectRoot?: string;
  userName: string;
  interval: Interval;
  connectorName: string;
  universe?: MarketUniverse;
  accountId?: string;
  deploymentId?: string;
  tickers?: string;
  exclude?: string;
  tickersLimit?: number;
  chunk?: string;
  makeOrders: boolean;
  notify: boolean;
  skipScreenshots: boolean;
  updateOnly: boolean;
  cacheOnly: boolean;
  showTickersList: boolean;
  showSkipStats: boolean;
  parallel?: number | string;
  watch?: boolean;
  settleDelayMs?: number | string;
  hasExplicitScope?: boolean;
}

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

export interface SignalsRunner {
  createSession: (
    lifecycle: SignalsStrategyLifecycle,
    scope?: {
      interval?: Interval;
      universe?: MarketUniverse;
      accountId?: string;
      connectorName?: string;
    },
  ) => Promise<SignalsSession>;
  runCycle: (options?: { session?: SignalsSession }) => Promise<void>;
  runConfiguredScopesOnce: () => Promise<void>;
  runDaemon: () => Promise<void>;
}

interface EvaluateTickerParams {
  symbol: string;
  connectorName: string;
  connector: Connector;
  btcBinanceData: Awaited<ReturnType<Connector['kline']>>;
  btcCoinbaseData: Awaited<ReturnType<Connector['kline']>>;
  primaryBtcClosedData: Awaited<ReturnType<Connector['kline']>>;
  primaryEthClosedData: Awaited<ReturnType<Connector['kline']>>;
  primaryEthByTimestamp: ReadonlyMap<
    number,
    Awaited<ReturnType<Connector['kline']>>[number]
  >;
  runtimeStrategies: StrategyRuntimeConfig[];
  strategyStats: StrategySkipStatsMap;
  runtimeCloseNotifications: RuntimeStrategyCloseNotification[];
  lifecycle: SignalsStrategyLifecycle;
  preloadStart: number;
  currentTimestamp: number;
  persistStrategyState: boolean;
  universe: MarketUniverse;
  interval: Interval;
  intervalMs: number;
  accountId?: string;
  deploymentId?: string;
  instrument?: InstrumentDescriptor;
  runtimeScopeUniverse?: MarketUniverse;
  saveRuntimeSignalEvaluation?: ReturnType<
    typeof createRuntimeSignalEvaluationBuffer
  >['save'];
  saveRuntimeSignal?: ReturnType<
    typeof createRuntimeSignalEvaluationBuffer
  >['saveSignal'];
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

export const createSignalsRunner = (
  config: SignalsRunnerConfig,
): SignalsRunner => {
  const interval = config.interval;
  const intervalMs = Number(interval) * 60_000;
  const projectRoot =
    config.projectRoot?.trim() ||
    String(process.env.PROJECT_CWD || process.cwd()).trim() ||
    process.cwd();

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

  const resolveSignalsConnectorName = async (
    value: unknown,
  ): Promise<string> => {
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

  const createSignalsSession = async (
    lifecycle: SignalsStrategyLifecycle,
    scope: {
      interval?: Interval;
      universe?: MarketUniverse;
      accountId?: string;
      connectorName?: string;
    } = {},
  ): Promise<SignalsSession> => {
    const deployment = config.deploymentId
      ? await getRuntimeDeployment(config.userName, config.deploymentId)
      : null;
    if (config.deploymentId && !deployment) {
      throw new Error(`Runtime deployment not found: ${config.deploymentId}`);
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
      deployment?.connectorName ?? scope.connectorName ?? config.connectorName,
    );
    const universe = (deployment?.universe ??
      scope.universe ??
      config.universe) as MarketUniverse;
    const requestedAccountId =
      deployment?.accountId ?? scope.accountId ?? config.accountId;
    const connectorFactory = await getConnectorCreatorByName(
      connectorName,
      projectRoot,
    );
    if (!connectorFactory) {
      throw new Error(`Connector "${connectorName}" is not registered`);
    }
    const marketConnector = await (connectorFactory as ConnectorCreator)({
      userName: config.userName,
      universe,
      accountId: requestedAccountId,
      deploymentId: deployment?.id,
    });
    const btcReferences = await loadBtcReferenceConnectors({
      connectorName,
      marketConnector,
      userName: config.userName,
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

  const evaluateTicker = async ({
    symbol,
    connectorName,
    connector,
    btcBinanceData,
    btcCoinbaseData,
    primaryBtcClosedData,
    primaryEthClosedData,
    primaryEthByTimestamp,
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
    deploymentId,
    instrument,
    runtimeScopeUniverse,
    saveRuntimeSignalEvaluation,
    saveRuntimeSignal,
  }: EvaluateTickerParams): Promise<Signal[]> => {
    const strategySignals: Signal[] = [];

    const loadCached = (cachedSymbol: string) =>
      connector.kline({
        symbol: cachedSymbol,
        start: preloadStart,
        end: currentTimestamp,
        cacheOnly: true,
        interval,
      });
    const cachedData =
      universe === 'crypto' && symbol === 'BTCUSDT'
        ? primaryBtcClosedData
        : universe === 'crypto' && symbol === 'ETHUSDT'
          ? primaryEthClosedData
          : await loadCached(symbol);

    // Runtime evaluates only on the last closed candle. Timestamp filtering keeps
    // cache-only runs from accidentally stepping one closed bar back when the
    // newest forming bar is absent from Timescale.
    const closedData = getClosedCandlesForInterval(
      cachedData,
      currentTimestamp,
      intervalMs,
    );
    const closedBtcData = primaryBtcClosedData;
    const closedEthData = primaryEthClosedData;
    const { alignedCoinCandles, alignedBtcCandles } =
      universe === 'crypto'
        ? alignSymbolWithBtcReference(closedData, closedBtcData)
        : { alignedCoinCandles: closedData, alignedBtcCandles: closedData };
    const alignedEthCandles = alignedCoinCandles
      .map((candle) => primaryEthByTimestamp.get(candle.timestamp))
      .filter((candle): candle is (typeof closedEthData)[number] =>
        Boolean(candle),
      );
    const lastCandle = alignedCoinCandles.at(-1);
    const btcLastCandle = alignedBtcCandles.at(-1);
    const ethLastCandle =
      lastCandle == null
        ? undefined
        : primaryEthByTimestamp.get(lastCandle.timestamp);

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
        sourceStrategyConfig,
        strategyConfig,
        strategyResults,
      } = runtimeStrategy;
      const runtimeConfig = buildRuntimeModeStrategyConfig({
        strategyConfig,
        env: 'CRON',
        interval,
        makeOrders: config.makeOrders,
      });
      const runtimeLineage = await buildRuntimeLineage({
        projectRoot,
        strategyName,
        config: {
          configId,
          strategyConfig,
          symbolResultConfig: strategyResults?.[symbol]?.config ?? null,
        },
        runContext: {
          connectorName: connectorName.toLowerCase(),
          interval: String(interval),
          universe,
        },
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
      const initialDataLength = previousData.length;
      const initialBtcDataLength = previousBtcData.length;
      const initialEthDataLength = previousEthData.length;
      let evaluation: Awaited<ReturnType<SignalsStrategyLifecycle['evaluate']>>;
      try {
        evaluation = await lifecycle.evaluate({
          key: lifecycleKey,
          timestamp: lastCandle.timestamp,
          config: {
            runtimeConfig,
            sourceStrategyConfig,
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
              userName: config.userName,
              connectorName,
              runtimeConfigId: configId,
              runtimeConfigSnapshot: {
                userConfig: sourceStrategyConfig,
                symbolResultConfig: strategyResults?.[symbol]?.config ?? null,
              },
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
              data: previousData,
              btcData: universe === 'crypto' ? previousBtcData : [],
              ethData: universe === 'crypto' ? previousEthData : [],
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
      } finally {
        // Disposable runtimes append the evaluated candle to their input arrays.
        // Restore the shared per-symbol warmup arrays before the next strategy so
        // every strategy sees the same history without allocating three copies.
        previousData.length = initialDataLength;
        previousBtcData.length = initialBtcDataLength;
        previousEthData.length = initialEthDataLength;
      }

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
        await saveRuntimeSignalEvaluation?.({
          evaluationId: buildRuntimeSignalEvaluationId({
            strategyName,
            symbol,
            timestamp: lastCandle.timestamp,
            runtimeConfigId: configId,
          }),
          userName: config.userName,
          strategy: strategyName,
          runtimeConfigId: configId,
          runtimeLineage,
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
      signal.runtimeLineage = runtimeLineage;
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
      saveRuntimeSignal?.(config.userName, signal);

      await saveRuntimeSignalEvaluation?.({
        evaluationId: buildRuntimeSignalEvaluationId({
          strategyName,
          symbol,
          timestamp: lastCandle.timestamp,
          runtimeConfigId: configId,
        }),
        userName: config.userName,
        strategy: strategyName,
        runtimeConfigId: configId,
        runtimeLineage,
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

  const signals = async (options: { session?: SignalsSession } = {}) => {
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
    const runtimeSignalEvaluations = createRuntimeSignalEvaluationBuffer();

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
          config.tickers || deployment?.tickers?.join(','),
          config.exclude,
          config.tickersLimit,
          config.chunk,
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

      if (config.showTickersList) {
        console.log(chalk.gray(JSON.stringify(tickers.sort(), null, 2)));

        return;
      }

      const projectConfig = await loadTradejsConfig(projectRoot);
      projectHooks = projectConfig.hooks;

      const currentTimestamp = getTimestamp();
      const preloadStart = getTimestamp(SIGNALS_CLI_PRELOAD_DAYS);

      if (!config.cacheOnly && session.klineFeed) {
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
      } else if (!config.cacheOnly) {
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
        userName: config.userName,
        projectRoot,
        symbols: tickers,
        universe,
        interval,
        startMs: currentTimestamp,
        endMs: currentTimestamp,
        preloadStartMs: preloadStart,
        cacheOnly: config.cacheOnly,
        log: (message) => logger.info(chalk.gray(message)),
      });

      if (config.updateOnly) {
        return;
      }

      const [
        btcBinanceData,
        btcCoinbaseData,
        primaryBtcCachedData,
        primaryEthCachedData,
      ] =
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
                marketConnector.kline({
                  symbol: 'BTCUSDT',
                  start: preloadStart,
                  end: currentTimestamp,
                  cacheOnly: true,
                  interval,
                }),
                marketConnector.kline({
                  symbol: 'ETHUSDT',
                  start: preloadStart,
                  end: currentTimestamp,
                  cacheOnly: true,
                  interval,
                }),
              ]),
            )
          : [[], [], [], []];
      const primaryBtcClosedData = getClosedCandlesForInterval(
        primaryBtcCachedData,
        currentTimestamp,
        intervalMs,
      );
      const primaryEthClosedData = getClosedCandlesForInterval(
        primaryEthCachedData,
        currentTimestamp,
        intervalMs,
      );
      const primaryEthByTimestamp = new Map(
        primaryEthClosedData.map((candle) => [candle.timestamp, candle]),
      );

      const runtimeStrategies = await loadRuntimeStrategies({
        userName: config.userName,
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
          config.userName,
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
          `loaded strategies (user=${config.userName}): ${runtimeStrategies.map((s) => s.strategyName).join(', ')}`,
        ),
      );
      afterSignalsHookContext = {
        connector: marketConnector,
        connectorName,
        userName: config.userName,
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
      const signalsParallel = resolvePositiveInteger(config.parallel, 4);
      logger.info(chalk.yellow(`signal workers: ${signalsParallel}`));

      await timeOperation('strategy evaluation', async () => {
        await runWithConcurrency(tickers, signalsParallel, async (symbol) => {
          const strategySignals = await evaluateTicker({
            symbol,
            connectorName,
            connector: marketConnector,
            btcBinanceData,
            btcCoinbaseData,
            primaryBtcClosedData,
            primaryEthClosedData,
            primaryEthByTimestamp,
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
            deploymentId: deployment?.id,
            instrument: instrumentsBySymbol.get(symbol),
            runtimeScopeUniverse: sessionUniverse,
            saveRuntimeSignalEvaluation: runtimeSignalEvaluations.save,
            saveRuntimeSignal: runtimeSignalEvaluations.saveSignal,
          });

          if (strategySignals.length > 0) {
            signals.push(...strategySignals);
          }

          bar.tick(1, {
            found: chalk.cyan(signals.length),
            symbol: chalk.gray(symbol),
          });
        });
      });

      if (config.notify) {
        const telegramSignals = getTelegramDeliverableSignals(signals);

        if (!config.skipScreenshots && telegramSignals.length > 0) {
          await makeScreenshots(telegramSignals, interval, config.userName);
        }

        await sendToTG(telegramSignals, interval, config.userName);
        await sendRuntimeCloseNotificationsToTG(
          runtimeCloseNotifications,
          config.userName,
        );
      }

      logger.info(
        JSON.stringify(
          signals.map((s) => s.symbol),
          null,
          2,
        ),
      );

      if (config.showSkipStats) {
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
      try {
        await runtimeSignalEvaluations.flush();
      } catch (error) {
        logger.error(
          'runtime signal evaluation flush failed: %s',
          (error as Error)?.message || String(error),
        );
      }
      const durationMs = Date.now() - startedAt;

      if (activeSession?.deployment) {
        await saveRuntimeDeploymentHeartbeat(config.userName, {
          deploymentId: activeSession.deployment.id,
          status: getSignalsHeartbeatStatus({
            cycleStatus: status,
            continuous: options.session != null || Boolean(config.watch),
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

      if (config.notify && durationMs > SLOW_SIGNALS_WARNING_MS) {
        try {
          await sendTextToTG(
            formatSlowSignalsWarning({
              durationMs,
              status,
              found: signals.length,
            }),
            { userName: config.userName },
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
      userName: config.userName,
      projectRoot,
      deployment,
      connectorName: config.connectorName,
    });
    const connectorName = await resolveSignalsConnectorName(
      deployment?.connectorName ?? config.connectorName,
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

  const hasExplicitSignalsScope = () => Boolean(config.hasExplicitScope);

  const signalsConfiguredScopesOnce = async () => {
    if (
      config.updateOnly ||
      config.showTickersList ||
      config.deploymentId ||
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

  const signalsDaemon = async () => {
    if (config.updateOnly || config.showTickersList) {
      throw new Error(
        'Signals daemon does not support updateOnly or showTickersList mode',
      );
    }

    const abortController = new AbortController();
    const daemonDeployment = config.deploymentId
      ? await getRuntimeDeployment(config.userName, config.deploymentId)
      : null;
    if (config.deploymentId && !daemonDeployment) {
      throw new Error(`Runtime deployment not found: ${config.deploymentId}`);
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
        settleDelayMs: resolveNonNegativeInteger(config.settleDelayMs, 5_000),
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
                  userName: config.userName,
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
          await saveRuntimeDeploymentHeartbeat(config.userName, {
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

  return {
    createSession: createSignalsSession,
    runCycle: signals,
    runConfiguredScopesOnce: signalsConfiguredScopesOnce,
    runDaemon: signalsDaemon,
  };
};
