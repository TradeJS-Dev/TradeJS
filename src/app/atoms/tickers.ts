import { atom } from 'recoil';

export const tickersState = atom({
  key: 'Tickers',
  default: {
    loaded: false,
    list: [
      { label: 'BTC', value: 'BTCUSDT' },
      { label: 'ETH', value: 'ETHUSDT' },
    ],
  },
});
