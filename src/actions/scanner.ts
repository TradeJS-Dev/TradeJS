'use server';

import { connectors } from '@src/connectors';
import { getTopTickers } from '@utils/tickers';

export const scanner = async () => {
  const byBitConnector = connectors.ByBit({
    key: '',
    secret: '',
  });

  const data = await byBitConnector.getTickers();

  return await getTopTickers(data);
};
