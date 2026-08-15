import { logger } from '@tradejs/infra/logger';
import { resolveTradingAccount } from '@tradejs/infra/tradingAccounts';
import type {
  ConnectorLogger,
  ConnectorRuntime,
  ConnectorCreator,
} from '@tradejs/types';
import { createTimescaleCachedKline } from './timescaleCachedKline';

export const connectorRuntime: ConnectorRuntime = {
  logger: logger as unknown as ConnectorLogger,
  resolveTradingAccount,
  createCachedKline: createTimescaleCachedKline,
};

export const bindConnectorRuntime = (
  creator: ConnectorCreator,
  runtime: ConnectorRuntime = connectorRuntime,
): ConnectorCreator => {
  const boundCreator: ConnectorCreator = (config) => creator(config, runtime);
  return boundCreator;
};
