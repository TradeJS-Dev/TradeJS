import { BreakoutStrategyCreator } from './Breakout';
import { TrendlineStrategyCreator } from './TrendLine';
import { VolumeDivergenceStrategyCreator } from './VolumeDivergence';
export { strategyManifests, getStrategyManifest } from './manifests';

export enum StrategyNames {
  Breakout = 'Breakout',
  TrendLine = 'TrendLine',
  VolumeDivergence = 'VolumeDivergence',
}

export const strategies = {
  [StrategyNames.Breakout]: BreakoutStrategyCreator,
  [StrategyNames.TrendLine]: TrendlineStrategyCreator,
  [StrategyNames.VolumeDivergence]: VolumeDivergenceStrategyCreator,
} as const;
