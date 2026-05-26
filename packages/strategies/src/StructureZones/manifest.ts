import { StrategyManifest } from '@tradejs/types';
import { structureZonesAiAdapter } from './adapters/ai';

export const structureZonesManifest: StrategyManifest = {
  name: 'StructureZones',
  aiAdapter: structureZonesAiAdapter,
};
