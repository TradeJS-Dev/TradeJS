import { BreakoutStrategyCreator, config } from '@src/strategy/Breakout';
import { BotConfig } from '@types';

const botConfig: BotConfig = [
  {
    symbol: 'DOGSUSDT',
    strategy: BreakoutStrategyCreator,
    strategyConfig: {
      ...config,
    },
  },
];

export default botConfig;
