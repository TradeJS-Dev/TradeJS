import { Interval } from '@types';

export const config = {
  INTERVAL: '15' as Interval,
  LIMIT: 100,
  ATR_PERIOD: 14,
  ATR_OPEN: 0.4,
  ATR_CLOSE: 1.2,
  CHANNEL_LOOKBACK: 30,

  CCI_PERIOD: 20,
  CCI_LOW: -100,   // перепроданность
  CCI_HIGH: 100,   // перекупленность
  MOM_PERIOD: 10,  // импульс

  TP_LONG: [
    { profit: 0.05, rate: 0.5 },
    { profit: 0.1, rate: 0.3 },
  ],
  TP_SHORT: [
    { profit: 0.05, rate: 0.5 },
    { profit: 0.1, rate: 0.3 },
  ],
  SL_LONG: 0.03,
  SL_SHORT: 0.03,
};
