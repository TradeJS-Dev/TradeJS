'use server';

import 'dotenv/config';
import { RestClientV5 } from 'bybit-api';
import { ConnectorConfig } from '@types';
import { getData } from '@utils/data';

const useTestnet = false;

export const getClient = async ({ userName }: ConnectorConfig) => {
  const user = await getData('data/users', userName, { useCache: false });

  if (!user) {
    return null;
  }
  
  const client = new RestClientV5({
    key: user.API_KEY,
    secret: user.API_SECRET,
    testnet: useTestnet,
  });

  return client;
};
