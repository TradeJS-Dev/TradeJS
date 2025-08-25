import { BreakoutStrategyCreator } from './Breakout';
import { BreakoutWeightsStrategyCreator } from './BreakoutWeights';
import { ChannelStrategyCreator } from './ChannelStrategy';

export enum StrategyNames {
  Breakout = 'Breakout',
  BreakoutWeights = 'BreakoutWeights',
  Channel = 'Channel',
}

export const strategies = {
  [StrategyNames.Breakout]: BreakoutStrategyCreator,
  [StrategyNames.BreakoutWeights]: BreakoutWeightsStrategyCreator,
  [StrategyNames.Channel]: ChannelStrategyCreator,
} as const;
