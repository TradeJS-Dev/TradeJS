import { BreakoutStrategyCreator } from './Breakout';
import { BreakoutWeightsStrategyCreator } from './BreakoutWeights';
import { ReversalPatternStrategyCreator } from './ReversalPattern';
import { ChannelStrategyCreator } from './ChannelStrategy';

export enum StrategyNames {
  Breakout = 'Breakout',
  BreakoutWeights = 'BreakoutWeights',
  Reversal = 'Reversal',
  Channel = 'Channel',
}

export const strategies = {
  [StrategyNames.Breakout]: BreakoutStrategyCreator,
  [StrategyNames.BreakoutWeights]: BreakoutWeightsStrategyCreator,
  [StrategyNames.Reversal]: ReversalPatternStrategyCreator,
  [StrategyNames.Channel]: ChannelStrategyCreator,
} as const;
