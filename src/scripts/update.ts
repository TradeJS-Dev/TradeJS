import _ from 'lodash';
import { PRELOAD_DAYS } from '@constants';
import { connectors } from '@src/connectors';
import { getTimestamp } from '@utils/timestamp';
import { getTopTickers } from '@utils/tickers';

const preloadStart = getTimestamp(PRELOAD_DAYS);
const end = getTimestamp();
const TICKERS_LIMIT = 10;
const LIST = ['BTCUSDT', 'DOGSUSDT'];

const byBitConnector = connectors.ByBit({
  key: '',
  secret: '',
});

export const scanner = async () => {
  const data = await byBitConnector.getTickers();

  const tickers = getTopTickers(data, TICKERS_LIMIT);
  return tickers.map(({ value }) => value);
};

const update = async () => {
  const volatilityTickers = await scanner();
  // const tickers = _.uniq([...volatilityTickers, ...LIST]);
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
