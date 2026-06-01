import chalk from 'chalk';
import { logger } from '@tradejs/infra/logger';
import { normalizeRuntimeSignalSkipReason } from '../runtimeSignalsStorage';
import type { StrategyRuntimeConfig } from './runtimeStrategies';

interface StrategySkipStats {
  evaluated: number;
  signals: number;
  reasons: Map<string, number>;
}

export type StrategySkipStatsMap = Map<string, StrategySkipStats>;
export type StrategySkipSource =
  | 'core'
  | 'AI'
  | 'ML'
  | 'hook'
  | 'policy'
  | 'runtime';

export const createStrategySkipStats = (
  runtimeStrategies: StrategyRuntimeConfig[],
): StrategySkipStatsMap =>
  new Map(
    runtimeStrategies.map(({ strategyName }) => [
      strategyName,
      {
        evaluated: 0,
        signals: 0,
        reasons: new Map<string, number>(),
      },
    ]),
  );

export const recordStrategyReason = (
  strategyStats: StrategySkipStatsMap,
  strategyName: string,
  reason: string,
  fallbackSource: StrategySkipSource = 'core',
) => {
  const stats = strategyStats.get(strategyName);
  if (!stats) {
    return;
  }

  const normalized = normalizeRuntimeSignalSkipReason(reason, fallbackSource);
  const normalizedReason = `${normalized.source} / ${normalized.reason}`;
  stats.reasons.set(
    normalizedReason,
    (stats.reasons.get(normalizedReason) ?? 0) + 1,
  );
};

export const logStrategySkipStats = (
  runtimeStrategies: StrategyRuntimeConfig[],
  strategyStats: StrategySkipStatsMap,
) => {
  logger.info(chalk.yellow('skip stats:'));

  for (const { strategyName } of runtimeStrategies) {
    const stats = strategyStats.get(strategyName);
    if (!stats) {
      continue;
    }

    logger.info(
      `${strategyName}: evaluated=${stats.evaluated}, signals=${stats.signals}`,
    );

    const sortedReasons = [...stats.reasons.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    );

    if (!sortedReasons.length) {
      logger.info('  none');
      continue;
    }

    for (const [reason, count] of sortedReasons) {
      logger.info(`  ${reason}: ${count}`);
    }
  }
};
