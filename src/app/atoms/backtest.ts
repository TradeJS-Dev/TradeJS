import { atom } from 'recoil';
import { BacktestConfig } from '@types';

export const backtestState = atom({
  key: 'BacktestConfig',
  default: {
    enabled: false,
    symbol: 'BTCUSDT',
    id: '1',
  } as BacktestConfig,
});
