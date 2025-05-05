import { atom } from 'recoil';
import { BacktestConfig } from '@types';

export const backtestState = atom({
  key: 'BacktestConfig',
  default: {
    enabled: true,
    symbol: 'DOGEUSDT',
    id: '1',
  } as BacktestConfig,
});
