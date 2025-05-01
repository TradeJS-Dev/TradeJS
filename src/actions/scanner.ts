'use server';

import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { getVolatilityTickers } from '@src/utils/tickers';

export const scanner = async () => {
  const byBitConnector = ByBitConnectorCreator({
    key: '',
    secret: '',
  });

  const data = await byBitConnector.getTickers();

  return await getVolatilityTickers(data);
};
