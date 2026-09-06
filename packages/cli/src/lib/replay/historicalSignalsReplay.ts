import chalk from 'chalk';
import ProgressBar from 'progress';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  releaseStrategyIndicatorsReplayCache,
  releaseStrategyReplayCache,
} from '@tradejs/core/strategies';
import { formatUnix } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import { getData, redisKeys } from '@tradejs/infra/redis';
import {
  getConnectorCreatorByName,
  DEFAULT_CONNECTOR_NAME,
} from '@tradejs/node/connectors';
import { loadTradejsConfig } from '@tradejs/node/cli';
import {
  enrichSignalWithBinanceMarketContext,
  getStrategyCreator,
} from '@tradejs/node/strategies';
import { getRuntimeStrategyPackageMetadata } from '@tradejs/node/runtimeStrategies';
import { Connector, ConnectorCreator, Interval } from '@tradejs/types';
import {
  PreparedRunEnvironment,
  ReplayStrategyConfig,
} from '../runEnvironment';
import { replayProjectRoot, replayUserName } from './cliConfig';
import { createPortfolioReplayConnector } from './portfolioReplayConnector';
import {
  invokeAfterSignalsHooks,
  invokeBeforeSignalsHooks,
} from '../signals/hooks';
import { buildRuntimeLineage } from '../runtimeLineage';
import {
  prepareHistoricalReplay,
  type ReplayRuntimeStrategy,
} from './historicalSignalsReplayPreparation';
import { executeHistoricalReplay } from './historicalSignalsReplayExecution';
import {
  collectHistoricalReplayResult,
  type HistoricalSignalsReplayResult,
} from './historicalSignalsReplayResults';

type ReplayCacheReleasers = {
  releaseStrategyIndicatorsReplayCache?: (keyPrefix: string) => void;
  releaseStrategyReplayCache?: (keyPrefix: string) => void;
};

let projectReplayCacheReleasers: ReplayCacheReleasers | null | undefined;

const getProjectReplayCacheReleasers = (): ReplayCacheReleasers | null => {
  if (projectReplayCacheReleasers !== undefined) {
    return projectReplayCacheReleasers;
  }
  try {
    const requireFromProject = createRequire(
      path.join(replayProjectRoot, 'package.json'),
    );
    projectReplayCacheReleasers = requireFromProject(
      '@tradejs/core/strategies',
    ) as ReplayCacheReleasers;
  } catch {
    projectReplayCacheReleasers = null;
  }
  return projectReplayCacheReleasers;
};

const releaseReplayCacheCopies = (
  keyPrefix: string,
  localRelease: (keyPrefix: string) => void,
  projectRelease: ((keyPrefix: string) => void) | undefined,
) => {
  localRelease(keyPrefix);
  if (projectRelease && projectRelease !== localRelease) {
    projectRelease(keyPrefix);
  }
};

export type { ReplayRuntimeLineageRecord } from './historicalSignalsReplayPreparation';
export type {
  HistoricalSignalsReplayResult,
  ReplayStrategyRunArtifacts,
} from './historicalSignalsReplayResults';

export type HistoricalReplayReferenceData = {
  btcMarketData: Awaited<ReturnType<Connector['kline']>>;
  ethMarketData: Awaited<ReturnType<Connector['kline']>>;
  btcBinanceData: Awaited<ReturnType<Connector['kline']>>;
  btcCoinbaseData: Awaited<ReturnType<Connector['kline']>>;
};

const loadRuntimeStrategies = async (
  runtimeStrategies: ReplayStrategyConfig[],
): Promise<ReplayRuntimeStrategy[]> => {
  const strategies = await Promise.all(
    runtimeStrategies.map(async (runtimeStrategy) => {
      const {
        strategyName,
        strategyRevision,
        deploymentCompositionId,
        strategyPackage,
        strategyPackageVersion,
        strategyDependencyVersions,
        runtimePackageVersion,
        strategyConfig,
        selection,
      } = runtimeStrategy;
      const strategyCreator = await getStrategyCreator(
        strategyName,
        replayProjectRoot,
      );
      if (!strategyCreator) {
        throw new Error(`Unknown strategy: ${strategyName}`);
      }
      const installed = await getRuntimeStrategyPackageMetadata({
        strategyName,
        projectRoot: replayProjectRoot,
      });
      if (
        installed.strategyPackage !== strategyPackage ||
        installed.strategyPackageVersion !== strategyPackageVersion ||
        JSON.stringify(installed.strategyDependencyVersions) !==
          JSON.stringify(strategyDependencyVersions) ||
        installed.runtimePackageVersion !== runtimePackageVersion
      ) {
        throw new Error(
          `Runtime evidence package mismatch for ${strategyName}: expected=${strategyPackage}@${strategyPackageVersion}/@tradejs/node@${runtimePackageVersion}, installed=${installed.strategyPackage ?? 'missing'}@${installed.strategyPackageVersion ?? 'missing'}/@tradejs/node@${installed.runtimePackageVersion ?? 'missing'}`,
        );
      }

      const strategyResults = (await getData(
        redisKeys.strategyResults(replayUserName, strategyName),
        {},
      )) as ReplayRuntimeStrategy['strategyResults'];

      return {
        strategyName,
        strategyRevision,
        deploymentCompositionId,
        strategyPackage,
        strategyPackageVersion,
        strategyDependencyVersions,
        runtimePackageVersion,
        strategyCreator,
        strategyConfig,
        strategyResults,
        ...(selection ? { selection } : {}),
      };
    }),
  );

  return strategies;
};

const loadReferenceConnector = async (connectorName: string) => {
  const connectorFactory = await getConnectorCreatorByName(
    connectorName,
    replayProjectRoot,
  );
  if (!connectorFactory) {
    throw new Error(`Connector "${connectorName}" is not registered`);
  }

  return await (connectorFactory as ConnectorCreator)({
    userName: replayUserName,
  });
};

const buildAfterSignalsContext = ({
  connector,
  connectorName,
  tickers,
  runtimeStrategies,
  interval,
}: {
  connector: Connector;
  connectorName: string;
  tickers: string[];
  runtimeStrategies: ReplayRuntimeStrategy[];
  interval: Interval;
}) => ({
  connector,
  connectorName,
  userName: replayUserName,
  interval,
  tickers: [...tickers],
  runtimeStrategies: runtimeStrategies.map(
    ({ strategyName, strategyConfig }) => ({
      strategyName,
      strategyConfig,
    }),
  ),
});

const getConnectorName = (connector: Connector) => {
  const name = 'name' in connector ? connector.name : undefined;
  return (
    String(name || DEFAULT_CONNECTOR_NAME).trim() || DEFAULT_CONNECTOR_NAME
  );
};

export const loadHistoricalReplayReferences = async ({
  preparedRun,
  interval,
}: {
  preparedRun: PreparedRunEnvironment;
  interval: Interval;
}): Promise<HistoricalReplayReferenceData> => {
  const connectorName = getConnectorName(preparedRun.marketConnector);
  const binanceConnector =
    connectorName.toLowerCase() === DEFAULT_CONNECTOR_NAME.toLowerCase()
      ? await loadReferenceConnector('Binance')
      : preparedRun.marketConnector;
  const coinbaseConnector =
    connectorName.toLowerCase() === DEFAULT_CONNECTOR_NAME.toLowerCase()
      ? await loadReferenceConnector('Coinbase')
      : preparedRun.marketConnector;
  const request = {
    symbol: 'BTCUSDT',
    start: preparedRun.preloadStart,
    end: preparedRun.window.end,
    cacheOnly: true,
    interval,
  } as const;
  const [btcBinanceData, btcCoinbaseData, btcMarketData, ethMarketData] =
    await Promise.all([
      binanceConnector.kline(request),
      coinbaseConnector.kline(request),
      preparedRun.marketConnector.kline(request),
      preparedRun.marketConnector.kline({ ...request, symbol: 'ETHUSDT' }),
    ]);
  return {
    btcMarketData,
    ethMarketData,
    btcBinanceData,
    btcCoinbaseData,
  };
};

export const runHistoricalSignalsReplay = async ({
  preparedRun,
  interval,
  runtimeStrategies,
  references,
  showProgress = true,
  collectSkipEvidence = true,
  collectSignals = true,
}: {
  preparedRun: PreparedRunEnvironment;
  interval: Interval;
  runtimeStrategies: ReplayStrategyConfig[];
  references?: HistoricalReplayReferenceData;
  showProgress?: boolean;
  collectSkipEvidence?: boolean;
  collectSignals?: boolean;
}): Promise<HistoricalSignalsReplayResult> => {
  const startedAt = Date.now();
  const projectConfig = await loadTradejsConfig(replayProjectRoot);
  const projectHooks = projectConfig.hooks;
  const loadedStrategies = await loadRuntimeStrategies(runtimeStrategies);
  const replayConnector = createPortfolioReplayConnector(
    preparedRun.marketConnector,
  );
  const connectorName = getConnectorName(preparedRun.marketConnector);
  const referenceData =
    references ??
    (await loadHistoricalReplayReferences({ preparedRun, interval }));

  const prepareBar = new ProgressBar(
    'prepare :current/:total [:bar][:percent] skipped=:skipped :etas(s) :symbol',
    {
      total: preparedRun.tickers.length,
      width: 30,
    },
  );
  const plan = await prepareHistoricalReplay(
    {
      userName: replayUserName,
      projectRoot: replayProjectRoot,
      preparedRun,
      interval,
      connectorName,
      replayConnector,
      strategies: loadedStrategies,
      references: {
        btcMarketData: referenceData.btcMarketData,
        ethMarketData: referenceData.ethMarketData,
        btcBinanceData: referenceData.btcBinanceData,
        btcCoinbaseData: referenceData.btcCoinbaseData,
      },
    },
    {
      progress: {
        tick: (tokens) => prepareBar.tick(1, tokens),
      },
      display: {
        skipped: (value) => chalk.yellow(value),
        symbol: (value) => chalk.gray(value),
      },
      buildLineage: buildRuntimeLineage,
    },
  );
  const hookContext = buildAfterSignalsContext({
    connector: replayConnector,
    connectorName: preparedRun.connectorName,
    tickers: preparedRun.tickers,
    runtimeStrategies: loadedStrategies,
    interval,
  });
  const cycleBar = new ProgressBar(
    'cycles  :current/:total [:bar][:percent] sig=:signals abort=:aborted :etas(s) :ts',
    {
      total: plan.orderedTimestamps.length,
      width: 30,
    },
  );
  const execution = await executeHistoricalReplay(
    {
      plan,
      connector: replayConnector,
      collectSkipEvidence,
      collectSignals,
      hooks: projectHooks,
      hookContext,
    },
    {
      clock: { now: Date.now },
      progress: {
        enabled: showProgress,
        tick: (tokens) => cycleBar.tick(1, tokens),
      },
      display: {
        signals: (value) => chalk.cyan(value),
        aborted: (value) => chalk.yellow(value),
        timestamp: (value) => chalk.gray(formatUnix(value)),
      },
      invokeBeforeSignals: invokeBeforeSignalsHooks,
      invokeAfterSignals: invokeAfterSignalsHooks,
      enrichSignal: (signal) =>
        enrichSignalWithBinanceMarketContext({ signal, env: 'PARITY' }),
      releaseIndicatorsCache: (keyPrefix) =>
        releaseReplayCacheCopies(
          keyPrefix,
          releaseStrategyIndicatorsReplayCache,
          getProjectReplayCacheReleasers()
            ?.releaseStrategyIndicatorsReplayCache,
        ),
      releaseReplayCache: (keyPrefix) =>
        releaseReplayCacheCopies(
          keyPrefix,
          releaseStrategyReplayCache,
          getProjectReplayCacheReleasers()?.releaseStrategyReplayCache,
        ),
    },
  );
  const artifacts = replayConnector.getReplayArtifacts();
  logger.info(
    chalk.gray(
      `signals replay historical cycles: ${plan.orderedTimestamps.length} (aborted=${execution.abortedCycles}) done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    ),
  );
  return collectHistoricalReplayResult({
    strategies: loadedStrategies,
    artifacts,
    signals: execution.signals,
    cycleCount: plan.orderedTimestamps.length,
    abortedCycles: execution.abortedCycles,
    runtimeLineages: plan.runtimeLineages,
    replayLineageScopes: execution.replayLineageScopes,
  });
};
