'use server';

import { connectors } from '@src/connectors';
import { Kline } from '@types';

export const kline: Kline = async (options) => {
  const byBitConnector = connectors.ByBit({
    key: '',
    secret: '',
  });

  return await byBitConnector.kline(options);
};
