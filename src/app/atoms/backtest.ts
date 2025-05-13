import { atom } from 'recoil';
import { Items } from '@types';

interface BacktestState {
  id: null | string;
  files: Items;
}

export const backtestState = atom<BacktestState>({
  key: 'Backtest',
  default: {
    id: null,
    files: [],
  },
});
