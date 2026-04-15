'use server';

import { RestClientV5 } from 'bybit-api';

import { logger } from '@tradejs/infra/logger';
import { getData, redisKeys } from '@tradejs/infra/redis';
import { ConnectorConfig } from '@tradejs/types';

const useTestnet = false;

export type ByBitRestAccess = 'private' | 'public';

export const getClient = async (
  { userName }: ConnectorConfig,
  access: ByBitRestAccess = 'private',
) => {
  if (access === 'public') {
    return new RestClientV5({
      parseAPIRateLimits: true,
      testnet: useTestnet,
    });
  }

  const user = await getData(redisKeys.user(userName));

  if (!user) {
    logger.log('error', 'connection config not found: %s', userName);

    return null;
  }

  const client = new RestClientV5({
    key: user.BYBIT_API_KEY,
    secret: user.BYBIT_API_SECRET,
    parseAPIRateLimits: true,
    testnet: useTestnet,
  });

  return client;
};
