'use server';

import { RestClientV5 } from 'bybit-api';

import { logger } from '@tradejs/infra/logger';
import { resolveTradingAccount } from '@tradejs/infra/tradingAccounts';
import { ConnectorConfig } from '@tradejs/types';

const PRIVATE_RECV_WINDOW_MS = 10_000;

export type ByBitRestAccess = 'private' | 'public';

export const getClient = async (
  config: ConnectorConfig,
  access: ByBitRestAccess = 'private',
) => {
  const account =
    access === 'public' && !config.accountId
      ? null
      : await resolveTradingAccount({
          userName: config.userName,
          accountId: config.accountId,
          provider: 'bybit',
          universe: config.universe,
        });
  const useTestnet = account?.environment === 'testnet';

  if (access === 'public') {
    return new RestClientV5({
      parseAPIRateLimits: true,
      testnet: useTestnet,
    });
  }

  if (!account?.apiKey || !account.apiSecret) {
    if (config.accountId) {
      logger.log(
        'error',
        'Bybit trading account config not found: user=%s account=%s',
        config.userName,
        config.accountId,
      );
    } else {
      logger.log('error', 'connection config not found: %s', config.userName);
    }

    return null;
  }

  const client = new RestClientV5({
    key: account.apiKey,
    secret: account.apiSecret,
    parseAPIRateLimits: true,
    recv_window: PRIVATE_RECV_WINDOW_MS,
    // Avoid noisy bybit-api console.error dumps when its internal
    // /v5/market/time sync probe hits transient network resets.
    syncTimeBeforePrivateRequests: false,
    testnet: useTestnet,
  });

  return client;
};
