import { BreakoutStrategyCreator } from './Breakout';

export enum StrategyNames {
  Breakout = 'Breakout',
}

export const strategies = {
  [StrategyNames.Breakout]: BreakoutStrategyCreator,
} as const;
