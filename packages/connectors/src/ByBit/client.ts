'use server';

import 'dotenv/config';
import { RestClientV5 } from 'bybit-api';

import { getData, logger, redisKeys } from '@tradejs/infra';
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
