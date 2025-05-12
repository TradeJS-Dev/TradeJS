import { BreakoutStrategyCreator, config } from '@src/strategy/Breakout';
import { getTimestamp } from '@utils/timestamp';
import { TestConfig } from '@types';

const start = getTimestamp(30);
const end = getTimestamp();

const testConfig: TestConfig = [
  {
    name: 'breakout',
    symbol: 'DOGSUSDT',
    strategy: BreakoutStrategyCreator,
    strategyConfig: {
      ...config,
    },
    options: {
      start,
      end,
    },
  },
];

export default testConfig;