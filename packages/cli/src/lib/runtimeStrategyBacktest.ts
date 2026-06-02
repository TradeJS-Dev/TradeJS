import chalk from 'chalk';
import { StrategyConfig, StrategyConfigGrid } from '@tradejs/types';
import { loadRuntimeStrategyConfigs } from './runtimeRedis';

export type RuntimeStrategyBacktestConfig = {
  strategyName: string;
  strategyConfig: StrategyConfig;
  backtestConfig: StrategyConfigGrid;
};

export const BACKTEST_CLI_RUNTIME_CONFIG_KEYS = new Set([
  'ENV',
  'INTERVAL',
  'MAKE_ORDERS',
  'CLOSE_OPPOSITE_POSITIONS',
  'BACKTEST_PRICE_MODE',
]);

export const toStrategyConfigGrid = (
  strategyConfig: StrategyConfig,
): StrategyConfigGrid =>
  Object.fromEntries(
    Object.entries(strategyConfig)
      .filter(([key]) => !BACKTEST_CLI_RUNTIME_CONFIG_KEYS.has(key))
      .map(([key, value]) => [key, [value]]),
  );

export const loadRuntimeStrategyBacktestConfigs = async (
  userName: string,
): Promise<RuntimeStrategyBacktestConfig[]> => {
  const configs = await loadRuntimeStrategyConfigs(userName, {
    onInvalidConfig: (key) => {
      console.log(chalk.yellow(`Skip invalid runtime strategy config: ${key}`));
    },
  });

  return configs.map(({ strategyName, strategyConfig }) => ({
    strategyName,
    strategyConfig,
    backtestConfig: toStrategyConfigGrid(strategyConfig),
  }));
};
