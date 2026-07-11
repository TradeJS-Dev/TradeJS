import chalk from 'chalk';
import {
  DEFAULT_CONNECTOR_NAME,
  getConnectorCreatorByName,
  resolveConnectorName,
} from '@tradejs/node/connectors';
import { update } from '@tradejs/node/cli';
import {
  BACKTEST_EXECUTION_INTERVAL,
  BACKTEST_DEFAULT_DAYS,
  BACKTEST_PRELOAD_DAYS,
} from '@tradejs/core/constants';
import { getBacktestPreloadStart, getTimestamp } from '@tradejs/core/time';
import {
  AssetClass,
  Connector,
  ConnectorCreator,
  InstrumentDescriptor,
  Interval,
  MarketUniverse,
  RuntimeDeployment,
} from '@tradejs/types';
import { resolveTimeWindow } from './timeWindow';
import {
  loadRuntimeStrategyBacktestConfigs,
  RuntimeStrategyBacktestConfig,
} from './runtimeStrategyBacktest';
import { timeOperation as runTimedOperation } from './runFormatting';
import {
  loadBtcReferenceConnectors,
  updateMarketHistoryWithBtcReferences,
} from './marketData/historyPrepare';
import { loadRunTickers } from './tickerUniverseCache';

export type ResolvedWindow = {
  start: number;
  end: number;
  source: string;
};

export type PreparedRunEnvironment = {
  connectorName: string;
  marketConnector: Connector;
  tickers: string[];
  instrumentsBySymbol: Map<string, InstrumentDescriptor>;
  window: ResolvedWindow;
  preloadStart: number;
  universe?: MarketUniverse;
  accountId?: string;
  deploymentId?: string;
  assetClasses?: AssetClass[];
  deployment?: RuntimeDeployment | null;
};

const timeOperation = async <T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> =>
  runTimedOperation(label, operation, (message) =>
    console.log(chalk.gray(message)),
  );

export const resolveBacktestExecutionPreloadInterval = (
  interval: Interval,
): Interval | null => {
  const normalized = String(interval);
  if (normalized === '15') {
    return BACKTEST_EXECUTION_INTERVAL as Interval;
  }
  if (normalized === '60') {
    return '15' as Interval;
  }
  return null;
};

const resolveRunConnectorName = async ({
  value,
  projectRoot,
}: {
  value: unknown;
  projectRoot: string;
}) => {
  const connectorName = await resolveConnectorName(value, projectRoot);
  if (connectorName) {
    return connectorName;
  }

  console.log(
    chalk.yellow(
      `Unknown connector "${String(value || '').trim() || String(value)}". Fallback to ${DEFAULT_CONNECTOR_NAME}.`,
    ),
  );
  return DEFAULT_CONNECTOR_NAME;
};

export const loadReplayStrategies = async (
  userName: string,
): Promise<RuntimeStrategyBacktestConfig[]> => {
  const runtimeStrategies = await loadRuntimeStrategyBacktestConfigs(userName);
  if (!runtimeStrategies.length) {
    console.log(
      chalk.yellow(
        `No active runtime strategy configs found by users:${userName}:strategies:*:config`,
      ),
    );
    return [];
  }

  return runtimeStrategies;
};

export const prepareRunEnvironment = async ({
  connector,
  userName,
  tickers,
  exclude,
  tickersLimit,
  showTickersList,
  days,
  startTime,
  endTime,
  cacheOnly,
  interval,
  projectRoot,
  universe = 'crypto',
  accountId,
  deploymentId,
  assetClasses,
  deployment,
}: {
  connector: unknown;
  userName: string;
  tickers?: unknown;
  exclude?: unknown;
  tickersLimit?: unknown;
  showTickersList?: unknown;
  days?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  cacheOnly?: unknown;
  interval: Interval;
  projectRoot: string;
  universe?: MarketUniverse;
  accountId?: string;
  deploymentId?: string;
  assetClasses?: AssetClass[];
  deployment?: RuntimeDeployment | null;
}): Promise<PreparedRunEnvironment | null> => {
  const connectorName = await resolveRunConnectorName({
    value: connector,
    projectRoot,
  });
  const connectorFactory = await getConnectorCreatorByName(
    connectorName,
    projectRoot,
  );
  if (!connectorFactory) {
    throw new Error(`Connector "${connectorName}" is not registered`);
  }

  const marketConnector = await (connectorFactory as ConnectorCreator)({
    userName,
    universe,
    accountId,
    deploymentId,
  });
  const resolvedTickersLimit =
    typeof tickersLimit === 'number'
      ? tickersLimit
      : typeof tickersLimit === 'string' && tickersLimit.trim()
        ? Number(tickersLimit)
        : undefined;
  const loadedTickers = await timeOperation('tickers load', () =>
    loadRunTickers({
      connector: marketConnector,
      connectorName,
      userName,
      include: typeof tickers === 'string' ? tickers : undefined,
      exclude: typeof exclude === 'string' ? exclude : undefined,
      limit: Number.isFinite(resolvedTickersLimit)
        ? resolvedTickersLimit
        : undefined,
      cacheOnly: Boolean(cacheOnly),
      universe,
      accountId,
      assetClasses,
    }),
  );

  if (showTickersList) {
    console.log(chalk.gray(JSON.stringify(loadedTickers.sort(), null, 2)));
    return null;
  }

  const instruments =
    !cacheOnly && typeof marketConnector.listInstruments === 'function'
      ? await timeOperation('instruments load', () =>
          marketConnector.listInstruments!({
            universe,
            assetClasses,
            symbols: loadedTickers,
          }),
        )
      : [];
  const instrumentsBySymbol = new Map(
    instruments.map((instrument) => [
      instrument.symbol.toUpperCase(),
      instrument,
    ]),
  );

  const window = resolveTimeWindow({
    days,
    startTime,
    endTime,
    defaultStartMs: getTimestamp(BACKTEST_DEFAULT_DAYS),
    defaultEndMs: getTimestamp(),
  });
  const preloadStart = getBacktestPreloadStart(
    window.start,
    BACKTEST_PRELOAD_DAYS,
  );

  if (!cacheOnly) {
    const btcReferences = await loadBtcReferenceConnectors({
      connectorName,
      marketConnector,
      userName,
      projectRoot,
      shouldUseDedicatedReferences: universe === 'crypto',
      requireDedicatedReferences: universe === 'crypto',
      warn: (message) => console.log(chalk.yellow(message)),
    });
    await updateMarketHistoryWithBtcReferences({
      marketConnector,
      connectorName,
      btcReferences,
      interval,
      symbols: loadedTickers,
      preloadStart,
      preloadEnd: window.end,
      universe,
      log: (message) => console.log(chalk.gray(message)),
    });

    const backtestExecutionInterval =
      resolveBacktestExecutionPreloadInterval(interval);
    if (
      backtestExecutionInterval &&
      String(backtestExecutionInterval) !== String(interval)
    ) {
      await timeOperation(`update ${connectorName} execution`, () =>
        update(
          marketConnector,
          backtestExecutionInterval,
          loadedTickers,
          undefined,
          {
            connectorLabel: connectorName,
            preloadStart,
            preloadEnd: window.end,
            skipCovered: true,
          },
        ),
      );
    }
  }

  return {
    connectorName,
    marketConnector,
    tickers: loadedTickers,
    instrumentsBySymbol,
    window,
    preloadStart,
    universe,
    accountId,
    deploymentId,
    assetClasses,
    deployment,
  };
};
