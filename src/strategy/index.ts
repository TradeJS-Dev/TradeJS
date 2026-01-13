import { BreakoutStrategyCreator } from './Breakout';
import { TrendlineStrategyCreator } from './TrendLine';

export enum StrategyNames {
  Breakout = 'Breakout',
  TrendLine = 'TrendLine',
}

export const strategies = {
  [StrategyNames.Breakout]: BreakoutStrategyCreator,
  [StrategyNames.TrendLine]: TrendlineStrategyCreator,
} as const;
