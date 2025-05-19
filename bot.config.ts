import { BreakoutStrategyCreator, config } from '@src/strategy/Breakout';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { BotConfig } from '@types';

const byBitConnector = ByBitConnectorCreator({
  key: '',
  secret: '',
});

const botConfig: BotConfig = [
  {
    symbol: 'DOGSUSDT',
    strategy: BreakoutStrategyCreator,
    strategyConfig: {
      ...config,
      LIMIT: 100,
      TP_LONG: [
        { profit: 0.1, rate: 0.5 },
        { profit: 0.2, rate: 0.5 },
      ],
      TP_SHORT: [
        { profit: 0.05, rate: 0.5 },
        { profit: 0.1, rate: 0.5 },
      ],
      Sl: 0.1,
    },
    connector: byBitConnector,
  },
];

export default botConfig;
