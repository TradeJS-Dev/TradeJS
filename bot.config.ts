import * as strategies from '@src/strategy';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { BotConfig } from '@types';

const byBitConnector = ByBitConnectorCreator({
  key: '',
  secret: '',
});

const botConfig: BotConfig = [
  {
    symbol: 'DOGSUSDT',
    strategyCreator: strategies.BreakoutStrategyCreator,
    strategyConfig: {
      MA_FAST: 16,
      MA_SLOW: 80,
      ATR_PERIOD: 15,
      ATR_OPEN: 0.6,
      ATR_CLOSE: 1.3,
      BB_PERIOD: 13,
      BB_STDDEV: 2,
      OBV_SMA_PERIOD: 65,
      BREAKOUT_LOOKBACK: 25,
      SL_LONG: 0.08,
      SL_SHORT: 0.08,
      TP_LONG: [
        {
          profit: 0.2,
          rate: 0.5,
        },
        {
          profit: 0.4,
          rate: 0.5,
        },
      ],
      TP_SHORT: [
        {
          profit: 0.03,
          rate: 0.25,
        },
        {
          profit: 0.07,
          rate: 0.25,
        },
        {
          profit: 0.1,
          rate: 0.25,
        },
        {
          profit: 0.15,
          rate: 0.25,
        },
      ],
    },
    connector: byBitConnector,
  },
];

export default botConfig;
