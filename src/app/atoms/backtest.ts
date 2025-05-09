import { atom } from 'recoil';
import { BacktestConfig } from '@types';

export const backtestState = atom({
  key: 'BacktestConfig',
  default: {
    enabled: true,
    symbol: 'DOGSUSDT',
    id: '1',
  } as BacktestConfig,
});
