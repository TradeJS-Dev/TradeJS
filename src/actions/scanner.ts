'use server';

import { connectors } from '@src/connectors';
import { getTopTickers } from '@utils/tickers';

export const scan = async () => {
  const byBitConnector = connectors.ByBit({
    key: '',
    secret: '',
  });

  const data = await byBitConnector.getTickers();

  return await getTopTickers(data);
};
