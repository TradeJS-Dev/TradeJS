import _ from 'lodash';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { getTimestamp } from '@utils/timestamp';
import { getTopTickers } from '@utils/tickers';

const preloadStart = getTimestamp(210);
const end = getTimestamp();
const TICKERS_LIMIT = 10;
const LIST = ['BTCUSDT', 'DOGSUSDT'];

const byBitConnector = ByBitConnectorCreator({
  key: '',
  secret: '',
});

export const scanner = async () => {
  const data = await byBitConnector.getTickers();

  const tickers = getTopTickers(data, TICKERS_LIMIT);
  return tickers.map(({ value }) => value);
};

const update = async () => {
  const volatilityTicers = await scanner();
  //const tickers = _.uniq([...volatilityTicers, ...LIST]);
  const tickers = ['DOGSUSDT'];

  for await (const symbol of tickers) {
    await byBitConnector.kline({
      symbol,
      start: preloadStart,
      end,
      interval: '15',
      silent: false,
    });
  }
};

update();
