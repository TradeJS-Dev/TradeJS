'use server';

import { RestClientV5 } from 'bybit-api';

import { logger } from '@tradejs/infra/logger';
import { getData, redisKeys } from '@tradejs/infra/redis';
import { ConnectorConfig } from '@tradejs/types';

const useTestnet = false;

export const getClient = async ({ userName }: ConnectorConfig) => {
  const user = await getData(redisKeys.user(userName));

  if (!user) {
    logger.log('error', 'connection config not found: %s', userName);

    return null;
  }

  const client = new RestClientV5({
    key: user.BYBIT_API_KEY,
    secret: user.BYBIT_API_SECRET,
    testnet: useTestnet,
  });

  return client;
};
