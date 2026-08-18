import { enrichSignalWithBinanceMarketContext } from '@tradejs/node/strategies';
import { logger } from '@tradejs/infra/logger';
import type {
  Connector,
  InstrumentDescriptor,
  Interval,
  MarketUniverse,
  RuntimeStrategyCloseNotification,
  Signal,
} from '@tradejs/types';
import {
  alignSymbolWithBtcReference,
  getClosedCandlesForInterval,
} from '../marketData/windows';
import { buildRuntimeLineage } from '../runtimeLineage';
import { buildRuntimeModeStrategyConfig } from '../runtimeModeConfig';
import {
  buildRuntimeSignalEvaluationId,
  createRuntimeSignalEvaluationBuffer,
} from './evaluations';
import {
  buildSignalsStrategyLifecycleKey,
  type SignalsStrategyLifecycle,
} from './runtimeLifecycle';
import type { StrategyRuntimeConfig } from './runtimeStrategies';
import { recordStrategyReason, type StrategySkipStatsMap } from './skipStats';

type CandleData = Awaited<ReturnType<Connector['kline']>>;

export type SignalsCycleContext = {
  connectorName: string;
  connector: Connector;
  btcBinanceData: CandleData;
  btcCoinbaseData: CandleData;
  primaryBtcClosedData: CandleData;
  primaryEthClosedData: CandleData;
  primaryEthByTimestamp: ReadonlyMap<number, CandleData[number]>;
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
  runtimeScopeUniverse?: MarketUniverse;
  saveRuntimeSignalEvaluation?: ReturnType<
    typeof createRuntimeSignalEvaluationBuffer
  >['save'];
  saveRuntimeSignal?: ReturnType<
    typeof createRuntimeSignalEvaluationBuffer
  >['saveSignal'];
};

export const createSignalsTickerEvaluator =
  ({
    userName,
    makeOrders,
    projectRoot,
    context,
  }: {
    userName: string;
    makeOrders: boolean;
    projectRoot: string;
    context: SignalsCycleContext;
  }) =>
  async (
    symbol: string,
    instrument?: InstrumentDescriptor,
  ): Promise<Signal[]> => {
    const {
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
      runtimeScopeUniverse,
      saveRuntimeSignalEvaluation,
      saveRuntimeSignal,
    } = context;
    const cachedData =
      universe === 'crypto' && symbol === 'BTCUSDT'
        ? primaryBtcClosedData
        : universe === 'crypto' && symbol === 'ETHUSDT'
          ? primaryEthClosedData
          : await connector.kline({
              symbol,
              start: preloadStart,
              end: currentTimestamp,
              cacheOnly: true,
              interval,
            });
    const closedData = getClosedCandlesForInterval(
      cachedData,
      currentTimestamp,
      intervalMs,
    );
    const { alignedCoinCandles, alignedBtcCandles } =
      universe === 'crypto'
        ? alignSymbolWithBtcReference(closedData, primaryBtcClosedData)
        : { alignedCoinCandles: closedData, alignedBtcCandles: closedData };
    const alignedEthCandles = alignedCoinCandles
      .map((candle) => primaryEthByTimestamp.get(candle.timestamp))
      .filter((candle): candle is CandleData[number] => Boolean(candle));
    const lastCandle = alignedCoinCandles.at(-1);
    const btcLastCandle = alignedBtcCandles.at(-1);
    const ethLastCandle = lastCandle
      ? primaryEthByTimestamp.get(lastCandle.timestamp)
      : undefined;
    if (!lastCandle || !btcLastCandle) return [];

    const previousData = alignedCoinCandles.slice(0, -1);
    const previousBtcData = alignedBtcCandles.slice(0, -1);
    const previousEthData = alignedEthCandles.filter(
      (candle) => candle.timestamp < lastCandle.timestamp,
    );
    const strategySignals: Signal[] = [];

    for (const runtimeStrategy of runtimeStrategies) {
      const {
        strategyName,
        configId,
        releaseVersion,
        controlState,
        strategyPackageVersion,
        runtimePackageVersion,
        strategyCreator,
        sourceStrategyConfig,
        strategyConfig,
        strategyResults,
      } = runtimeStrategy;
      const runtimeIdentity = releaseVersion
        ? `v${releaseVersion}`
        : configId ?? 'config';
      const symbolResultConfig = strategyResults?.[symbol]?.config ?? null;
      const runtimeConfig = buildRuntimeModeStrategyConfig({
        strategyConfig,
        env: 'CRON',
        interval,
        makeOrders,
      });
      const runtimeLineage = await buildRuntimeLineage({
        projectRoot,
        strategyName,
        releaseVersion,
        strategyPackageVersion,
        runtimePackageVersion,
        config: { configId, strategyConfig, symbolResultConfig },
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
        configId: runtimeIdentity,
      });
      const stats = strategyStats.get(strategyName);
      const initialLengths = [
        previousData.length,
        previousBtcData.length,
        previousEthData.length,
      ];
      let evaluation: Awaited<ReturnType<SignalsStrategyLifecycle['evaluate']>>;
      try {
        evaluation = await lifecycle.evaluate({
          key: lifecycleKey,
          timestamp: lastCandle.timestamp,
          config: { runtimeConfig, sourceStrategyConfig, symbolResultConfig },
          btcBinanceData,
          btcCoinbaseData,
          onRuntimeClose: (event) => runtimeCloseNotifications.push(event),
          create: ({
            btcBinanceData: lifecycleBtcBinanceData,
            btcCoinbaseData: lifecycleBtcCoinbaseData,
            onRuntimeClose,
          }) =>
            strategyCreator({
              userName,
              connectorName,
              runtimeConfigId: configId,
              runtimeReleaseVersion: releaseVersion,
              entriesPaused: controlState === 'entries_paused',
              runtimeLineage,
              runtimeConfigSnapshot: {
                userConfig: sourceStrategyConfig,
                symbolResultConfig,
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
        previousData.length = initialLengths[0];
        previousBtcData.length = initialLengths[1];
        previousEthData.length = initialLengths[2];
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
      if (stats) stats.evaluated += 1;
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
            runtimeReleaseVersion: releaseVersion,
          }),
          userName,
          strategy: strategyName,
          runtimeConfigId: configId,
          runtimeReleaseVersion: releaseVersion,
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

      if (stats) stats.signals += 1;
      signal.runtimeConfigId = configId;
      signal.runtimeReleaseVersion = releaseVersion;
      signal.runtimeLineage = runtimeLineage;
      if (
        configId &&
        configId !== 'config' &&
        !signal.signalId.endsWith(`:${configId}`)
      ) {
        signal.signalId = `${signal.signalId}:${configId}`;
      }
      if (releaseVersion && !signal.signalId.endsWith(`:v${releaseVersion}`)) {
        signal.signalId = `${signal.signalId}:v${releaseVersion}`;
      }
      await enrichSignalWithBinanceMarketContext({ signal, env: 'CRON' });
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
      saveRuntimeSignal?.(userName, signal);
      await saveRuntimeSignalEvaluation?.({
        evaluationId: buildRuntimeSignalEvaluationId({
          strategyName,
          symbol,
          timestamp: lastCandle.timestamp,
          runtimeConfigId: configId,
          runtimeReleaseVersion: releaseVersion,
        }),
        userName,
        strategy: strategyName,
        runtimeConfigId: configId,
        runtimeReleaseVersion: releaseVersion,
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
