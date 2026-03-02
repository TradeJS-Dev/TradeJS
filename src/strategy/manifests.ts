import { StrategyCreator, StrategyManifest } from '@types';
import { breakoutManifest } from './Breakout/manifest';
import { trendLineManifest } from './TrendLine/manifest';
import { volumeDivergenceManifest } from './VolumeDivergence/manifest';

const createLazyStrategyCreator = <TModule extends Record<string, unknown>>(
  loader: () => Promise<TModule>,
  exportName: keyof TModule,
): StrategyCreator => {
  return async (params) => {
    const module = await loader();
    const creator = module[exportName];
    if (typeof creator !== 'function') {
      throw new Error(
        `Strategy creator export "${String(exportName)}" is missing`,
      );
    }
    return (creator as StrategyCreator)(params);
  };
};

export const strategyEntries = [
  {
    manifest: breakoutManifest,
    creator: createLazyStrategyCreator(
      () => import('./Breakout/strategy'),
      'BreakoutStrategyCreator',
    ),
  },
  {
    manifest: trendLineManifest,
    creator: createLazyStrategyCreator(
      () => import('./TrendLine/strategy'),
      'TrendlineStrategyCreator',
    ),
  },
  {
    manifest: volumeDivergenceManifest,
    creator: createLazyStrategyCreator(
      () => import('./VolumeDivergence/strategy'),
      'VolumeDivergenceStrategyCreator',
    ),
  },
] as const;

export const strategyManifests: StrategyManifest[] = strategyEntries.map(
  ({ manifest }) => manifest,
);

export const strategies = Object.fromEntries(
  strategyEntries.map(({ manifest, creator }) => [manifest.name, creator]),
) as Record<string, StrategyCreator>;

export const strategyManifestMap = Object.fromEntries(
  strategyManifests.map((manifest) => [manifest.name, manifest]),
) as Record<string, StrategyManifest>;

export const getStrategyManifest = (
  name?: string,
): StrategyManifest | undefined =>
  name ? strategyManifestMap[name] : undefined;

export const strategyNames = strategyEntries.map(
  ({ manifest }) => manifest.name,
);

export const isKnownStrategy = (name: string): boolean =>
  Boolean(strategies[name]);
