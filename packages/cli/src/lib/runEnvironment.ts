import chalk from 'chalk';
import { ConnectorNames } from '@tradejs/connectors';
import {
  DEFAULT_CONNECTOR_NAME,
  getConnectorCreatorByName,
  resolveConnectorName,
} from '@tradejs/node/connectors';
import { getTickers, update } from '@tradejs/node/cli';
import {
  BACKTEST_DEFAULT_DAYS,
  BACKTEST_PRELOAD_DAYS,
} from '@tradejs/core/constants';
import { getBacktestPreloadStart, getTimestamp } from '@tradejs/core/time';
import { Connector, ConnectorCreator, Interval } from '@tradejs/types';
import { resolveTimeWindow } from './timeWindow';
import {
  loadRuntimeStrategyBacktestConfigs,
  RuntimeStrategyBacktestConfig,
} from './runtimeStrategyBacktest';

export type ResolvedWindow = {
  start: number;
  end: number;
  source: string;
};

export type PreparedRunEnvironment = {
  connectorName: string;
  marketConnector: Connector;
  tickers: string[];
  window: ResolvedWindow;
  preloadStart: number;
};

const formatDuration = (startedAt: number) => {
  const seconds = (Date.now() - startedAt) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}m ${restSeconds}s`;
};

const timeOperation = async <T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    console.log(chalk.gray(`${label}: done in ${formatDuration(startedAt)}`));
  }
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
  });
  const resolvedTickersLimit =
    typeof tickersLimit === 'number'
      ? tickersLimit
      : typeof tickersLimit === 'string' && tickersLimit.trim()
        ? Number(tickersLimit)
        : undefined;
  const loadedTickers = await timeOperation('tickers load', () =>
    getTickers(
      marketConnector,
      typeof tickers === 'string' ? tickers : undefined,
      typeof exclude === 'string' ? exclude : undefined,
      Number.isFinite(resolvedTickersLimit) ? resolvedTickersLimit : undefined,
    ),
  );

  if (showTickersList) {
    console.log(chalk.gray(JSON.stringify(loadedTickers.sort(), null, 2)));
    return null;
  }

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
    await timeOperation(`update ${connectorName}`, () =>
      update(marketConnector, interval, loadedTickers, undefined, {
        connectorLabel: connectorName,
        preloadStart,
        preloadEnd: window.end,
      }),
    );

    const binanceConnectorCreator = await getConnectorCreatorByName(
      ConnectorNames.Binance,
      projectRoot,
    );
    const coinbaseConnectorCreator = await getConnectorCreatorByName(
      ConnectorNames.Coinbase,
      projectRoot,
    );
    if (!binanceConnectorCreator || !coinbaseConnectorCreator) {
      throw new Error('Binance/Coinbase connectors are required');
    }

    const binanceConnector = await (
      binanceConnectorCreator as ConnectorCreator
    )({
      userName,
    });
    const coinbaseConnector = await (
      coinbaseConnectorCreator as ConnectorCreator
    )({
      userName,
    });
    await timeOperation(`update ${ConnectorNames.Binance}`, () =>
      update(binanceConnector, interval, ['BTCUSDT'], undefined, {
        connectorLabel: ConnectorNames.Binance,
        preloadStart,
        preloadEnd: window.end,
      }),
    );
    await timeOperation(`update ${ConnectorNames.Coinbase}`, () =>
      update(coinbaseConnector, interval, ['BTCUSDT'], undefined, {
        connectorLabel: ConnectorNames.Coinbase,
        preloadStart,
        preloadEnd: window.end,
      }),
    );
  }

  return {
    connectorName,
    marketConnector,
    tickers: loadedTickers,
    window,
    preloadStart,
  };
};
