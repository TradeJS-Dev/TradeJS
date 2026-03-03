import { StrategyManifest } from '@types';
import { pineScriptAiAdapter } from './adapters/ai';
import { pineScriptMlAdapter } from './adapters/ml';

export const pineScriptManifest: StrategyManifest = {
  name: 'PineScript',
  aiAdapter: pineScriptAiAdapter,
  mlAdapter: pineScriptMlAdapter,
};
