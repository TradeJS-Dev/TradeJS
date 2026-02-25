import { BreakoutStrategyCreator } from './Breakout';
import { TrendlineStrategyCreator } from './TrendLine';
export { strategyManifests, getStrategyManifest } from './manifests';

export enum StrategyNames {
  Breakout = 'Breakout',
  TrendLine = 'TrendLine',
}

export const strategies = {
  [StrategyNames.Breakout]: BreakoutStrategyCreator,
  [StrategyNames.TrendLine]: TrendlineStrategyCreator,
} as const;
