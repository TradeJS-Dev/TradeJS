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
      MA_FAST: 30,
      MA_SLOW: 110,
      Sl: 0.05,
      ATR_PERIOD: 14,
      ATR_OPEN: 0.7,
      ATR_CLOSE: 2,
      BB_PERIOD: 15,
      BB_STDDEV: 2,
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
          profit: 0.05,
          rate: 0.3,
        },
        {
          profit: 0.1,
          rate: 0.3,
        },
        {
          profit: 0.2,
          rate: 0.3,
        },
      ],
    },
    connector: byBitConnector,
  },
];

export default botConfig;
