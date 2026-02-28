import { StrategyManifest } from '@types';
import { breakoutManifest } from './Breakout/manifest';
import { trendLineManifest } from './TrendLine/manifest';
import { volumeDivergenceManifest } from './VolumeDivergence/manifest';

export const strategyManifests: StrategyManifest[] = [
  breakoutManifest,
  trendLineManifest,
  volumeDivergenceManifest,
];

export const strategyManifestMap = Object.fromEntries(
  strategyManifests.map((manifest) => [manifest.name, manifest]),
) as Record<string, StrategyManifest>;

export const getStrategyManifest = (
  name?: string,
): StrategyManifest | undefined =>
  name ? strategyManifestMap[name] : undefined;
