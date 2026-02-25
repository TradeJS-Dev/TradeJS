import { StrategyManifest } from '@types';
import { breakoutManifest } from './Breakout/manifest';
import { trendLineManifest } from './TrendLine/manifest';

export const strategyManifests: StrategyManifest[] = [
  breakoutManifest,
  trendLineManifest,
];

export const strategyManifestMap = Object.fromEntries(
  strategyManifests.map((manifest) => [manifest.name, manifest]),
) as Record<string, StrategyManifest>;

export const getStrategyManifest = (name?: string): StrategyManifest | undefined =>
  name ? strategyManifestMap[name] : undefined;
