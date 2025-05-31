import { strategies, StrategyNames } from '@src/strategy';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { BotConfig } from '@types';

const byBitConnector = ByBitConnectorCreator({
  key: '',
  secret: '',
});

const botConfig: BotConfig = [
  {
    symbol: 'DOGSUSDT',
    strategyCreator: strategies.breakout,
    strategyConfig: {
      MA_FAST: 14,
      MA_SLOW: 85,
      ATR_PERIOD: 15,
      ATR_OPEN: 0.6,
      ATR_CLOSE: 1.3,
      BB_PERIOD: 13,
      BB_STDDEV: 2,
      OBV_SMA_PERIOD: 75,
      BREAKOUT_LOOKBACK: 20,
      SL_LONG: 0.05,
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
