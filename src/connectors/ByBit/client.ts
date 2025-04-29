'use server';

import 'dotenv/config';
import { RestClientV5 } from 'bybit-api';
import { ConnectorConfig } from '@types';

const API_KEY = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_API_SECRET;
const useTestnet = false;

export const getClient = (config: ConnectorConfig) => {
  const client = new RestClientV5({
    key: API_KEY,
    secret: API_SECRET,
    testnet: useTestnet,
  });

  return client;
};
