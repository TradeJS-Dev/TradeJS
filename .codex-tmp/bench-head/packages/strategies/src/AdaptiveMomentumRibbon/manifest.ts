import { adaptiveMomentumRibbonAiAdapter } from './adapters/ai';
import { adaptiveMomentumRibbonMlAdapter } from './adapters/ml';
import { StrategyManifest } from '@tradejs/types';

export const adaptiveMomentumRibbonManifest: StrategyManifest = {
  name: 'AdaptiveMomentumRibbon',
  aiAdapter: adaptiveMomentumRibbonAiAdapter,
  mlAdapter: adaptiveMomentumRibbonMlAdapter,
};
