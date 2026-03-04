import { StrategyManifest } from '@types';
import { adaptiveMomentumRibbonAiAdapter } from './adapters/ai';
import { adaptiveMomentumRibbonMlAdapter } from './adapters/ml';

export const adaptiveMomentumRibbonManifest: StrategyManifest = {
  name: 'AdaptiveMomentumRibbon',
  aiAdapter: adaptiveMomentumRibbonAiAdapter,
  mlAdapter: adaptiveMomentumRibbonMlAdapter,
};
