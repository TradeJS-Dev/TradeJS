'use server';

import { connectors } from '@src/connectors';
import { getTopTickers } from '@utils/tickers';

export const scan = async () => {
  const byBitConnector = connectors.ByBit({
    userName: 'root',
  });

  const data = await byBitConnector.getTickers();

  return getTopTickers(data);
};
