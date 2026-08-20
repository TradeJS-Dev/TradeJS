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
import { getTimestamp } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import { saveRuntimeDeploymentHeartbeat } from '@tradejs/infra/runtimeHeartbeats';
import { getRuntimeDeployment } from '@tradejs/node/runtimeStrategies';
import {
  Connector,
  ConnectorCreator,
  Interval,
  MarketUniverse,
  RuntimeDeployment,
  RuntimeStrategySelection,
  RuntimeStrategyCloseNotification,
  Signal,
} from '@tradejs/types';
import { getClosedCandlesForInterval } from '../marketData/windows';
import { loadRuntimeActiveTrades } from '../runtimeRedis';
import { timeOperation as runTimedOperation } from '../runFormatting';
import { invokeAfterSignalsHooks, invokeBeforeSignalsHooks } from './hooks';
import { prepareMarketContextForRun } from '../marketContextPrepare';
import {
  loadBtcReferenceConnectors,
  updateBtcReferenceHistory,
  updateMarketHistoryWithBtcReferences,
  updatePrimaryMarketHistory,
} from '../marketData/historyPrepare';
import { loadRuntimeStrategies } from './runtimeStrategies';
import { createStrategySkipStats, logStrategySkipStats } from './skipStats';
import { createRuntimeSignalEvaluationBuffer } from './evaluations';
import { getTelegramDeliverableSignals } from './telegram';
import {
  buildSignalsStrategyLifecycleKey,
  createSignalsStrategyLifecycle,
  type SignalsStrategyLifecycle,
} from './runtimeLifecycle';
import { getSignalsHeartbeatStatus, runSignalsDaemon } from './daemon';
import { createSignalsKlineFeed, type SignalsKlineFeed } from './klineFeed';
import { createSignalsTickerEvaluator } from './tickerEvaluator';
import {
  buildConfiguredSignalsScopes,
  formatConfiguredStrategyIdentity,
  getConfiguredScopeActiveSymbols,
  type ConfiguredSignalsScope,
} from './configuredScopes';

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
}

export interface SignalsSession {
  connectorName: string;
  universe: MarketUniverse;
  accountId?: string;
  interval: Interval;
  intervalMs: number;
  deployment?: RuntimeDeployment | null;
  strategyNames?: string[];
  selection?: RuntimeStrategySelection;
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
      strategyNames?: string[];
      selection?: RuntimeStrategySelection;
    },
  ) => Promise<SignalsSession>;
  runCycle: (options?: { session?: SignalsSession }) => Promise<void>;
  runConfiguredScopesOnce: () => Promise<void>;
  runDaemon: () => Promise<void>;
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
    if (!connectorName) {
      throw new Error(
        `Unknown runtime connector: ${String(value || '').trim() || String(value)}`,
      );
    }
    return connectorName;
  };

  const createSignalsSession = async (
    lifecycle: SignalsStrategyLifecycle,
    scope: {
      interval?: Interval;
      universe?: MarketUniverse;
      accountId?: string;
      connectorName?: string;
      strategyNames?: string[];
      selection?: RuntimeStrategySelection;
    } = {},
  ): Promise<SignalsSession> => {
    const deployment = config.deploymentId
      ? await getRuntimeDeployment({
          userName: config.userName,
          projectRoot,
          deploymentId: config.deploymentId,
        })
      : null;
    if (config.deploymentId && !deployment) {
      throw new Error(`Runtime deployment not found: ${config.deploymentId}`);
    }
    const requestedRuntimeInterval = (scope.interval ?? interval) as Interval;
    const runtimeInterval = requestedRuntimeInterval;
    const runtimeIntervalMs = Number(runtimeInterval) * 60_000;
    if (!Number.isFinite(runtimeIntervalMs) || runtimeIntervalMs <= 0) {
      throw new Error(`Invalid runtime timeframe: ${runtimeInterval}`);
    }
    const connectorName = await resolveSignalsConnectorName(
      deployment?.connectorName ?? scope.connectorName ?? config.connectorName,
    );
    const universe = (scope.universe ?? config.universe) as MarketUniverse;
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
      ...(scope.strategyNames
        ? { strategyNames: [...scope.strategyNames] }
        : {}),
      ...(scope.selection
        ? {
            selection: { tickers: [...scope.selection.tickers] },
          }
        : {}),
      startedAt: Date.now(),
      marketConnector,
      btcReferences,
      lifecycle,
    };
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
        strategyNames,
        selection,
      } = session;
      const universe =
        sessionUniverse ?? marketConnector.universe ?? ('crypto' as const);

      const selectedActiveSymbols =
        !config.tickers && selection?.tickers?.length && strategyNames?.length
          ? getConfiguredScopeActiveSymbols({
              trades: await loadRuntimeActiveTrades(config.userName),
              deploymentId: deployment?.id ?? '',
              strategyNames,
              universe,
              accountId,
              interval,
            })
          : [];
      const selectedTickers = selection?.tickers
        ? [...new Set([...selection.tickers, ...selectedActiveSymbols])]
        : undefined;
      if (selectedActiveSymbols.length) {
        logger.info(
          chalk.gray(
            `strategy selection retained active symbols: ${selectedActiveSymbols.join(', ')}`,
          ),
        );
      }
      const tickers = await timeOperation('tickers load', () => {
        const baseArgs = [
          marketConnector,
          config.tickers ||
            selectedTickers?.join(',') ||
            deployment?.tickers?.join(','),
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
        (!config.cacheOnly || universe === 'tradfi') &&
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

      const configuredRuntimeStrategies = await loadRuntimeStrategies({
        userName: config.userName,
        projectRoot,
        deploymentId: deployment?.id ?? '',
        universe,
        accountId,
        interval,
      });
      const selectedStrategyNames = strategyNames?.length
        ? new Set(strategyNames)
        : null;
      const runtimeStrategies = selectedStrategyNames
        ? configuredRuntimeStrategies.filter(({ strategyName }) =>
            selectedStrategyNames.has(strategyName),
          )
        : configuredRuntimeStrategies;
      if (!runtimeStrategies.length) {
        lifecycle.clear();
        logger.warn(
          'No strategy releases are bound to deployment %s',
          deployment?.id,
        );
        return;
      }
      lifecycle.retain(
        new Set(
          tickers.flatMap((symbol) =>
            runtimeStrategies.map(({ strategyName, strategyRevision }) =>
              buildSignalsStrategyLifecycleKey({
                connectorName,
                universe: sessionUniverse,
                accountId,
                deploymentId: deployment?.id,
                symbol,
                interval,
                strategyName,
                configId: strategyRevision,
              }),
            ),
          ),
        ),
      );
      logger.info(
        chalk.yellow(
          `loaded strategies (user=${config.userName}): ${runtimeStrategies.map(formatConfiguredStrategyIdentity).join(', ')}`,
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
      const evaluateTicker = createSignalsTickerEvaluator({
        userName: config.userName,
        makeOrders: config.makeOrders,
        projectRoot,
        context: {
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
          runtimeScopeUniverse: sessionUniverse,
          saveRuntimeSignalEvaluation: runtimeSignalEvaluations.save,
          saveRuntimeSignal: runtimeSignalEvaluations.saveSignal,
        },
      });

      await timeOperation('strategy evaluation', async () => {
        await runWithConcurrency(tickers, signalsParallel, async (symbol) => {
          const strategySignals = await evaluateTicker(
            symbol,
            instrumentsBySymbol.get(symbol),
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

      if (config.notify) {
        const telegramSignals = getTelegramDeliverableSignals(signals);

        if (!config.skipScreenshots && telegramSignals.length > 0) {
          await runtimeSignalEvaluations.flushSignals();
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

  const loadConfiguredSignalsScopes = async (deployment: RuntimeDeployment) => {
    const configuredStrategies = await loadRuntimeStrategies({
      userName: config.userName,
      projectRoot,
      deploymentId: deployment.id,
    });
    const connectorName = await resolveSignalsConnectorName(
      deployment.connectorName,
    );
    return new Map<string, ConfiguredSignalsScope>(
      buildConfiguredSignalsScopes({
        connectorName,
        deployment,
        strategies: configuredStrategies,
      }).map(({ key, scope }) => [key, scope]),
    );
  };

  const signalsConfiguredScopesOnce = async () => {
    if (config.updateOnly || config.showTickersList) {
      return signals();
    }
    if (!config.deploymentId) {
      throw new Error('Runtime deployment id is required');
    }
    const configuredDeployment = await getRuntimeDeployment({
      userName: config.userName,
      projectRoot,
      deploymentId: config.deploymentId,
    });
    if (!configuredDeployment) {
      throw new Error(`Runtime deployment not found: ${config.deploymentId}`);
    }
    const scopes = await loadConfiguredSignalsScopes(configuredDeployment);
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
    if (!config.deploymentId) {
      throw new Error('Runtime deployment id is required');
    }
    const deploymentId = config.deploymentId;
    const initialDeployment = await getRuntimeDeployment({
      userName: config.userName,
      projectRoot,
      deploymentId,
    });
    if (!initialDeployment) {
      throw new Error(`Runtime deployment not found: ${deploymentId}`);
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

    logger.info('signals daemon started (deployment-driven scopes)');
    try {
      await runSignalsDaemon({
        intervalMs: 60_000,
        settleDelayMs: resolveNonNegativeInteger(config.settleDelayMs, 5_000),
        signal: abortController.signal,
        runCycle: async () => {
          const currentDeployment = await getRuntimeDeployment({
            userName: config.userName,
            projectRoot,
            deploymentId,
          });
          if (!currentDeployment) {
            throw new Error(`Runtime deployment not found: ${deploymentId}`);
          }
          const scopes = await loadConfiguredSignalsScopes(currentDeployment);

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
