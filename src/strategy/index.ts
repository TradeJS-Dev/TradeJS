import { BreakoutStrategyCreator } from './Breakout';
import { ReversalPatternStrategyCreator } from './ReverlasPattern';
import { ChannelStrategyCreator } from './ChannelStrategy';

export enum StrategyNames {
  breakout = 'breakout',
  reversal = 'reversal',
  channel = 'channel',
}

export const strategies = {
  [StrategyNames.breakout]: BreakoutStrategyCreator,
  [StrategyNames.reversal]: ReversalPatternStrategyCreator,
  [StrategyNames.channel]: ChannelStrategyCreator,
} as const;
