import _ from 'lodash';
import { getData, redisKeys } from '@tradejs/infra';
import { StrategyConfig, StrategyResults } from '@tradejs/types';

interface ResolveStrategyConfigParams<TConfig extends StrategyConfig> {
  strategyName: string;
  userName: string;
  symbol: string;
  baseConfig: Record<string, any>;
  defaults: TConfig;
}

export const resolveStrategyConfig = async <TConfig extends StrategyConfig>({
  strategyName,
  userName,
  symbol,
  baseConfig,
  defaults,
}: ResolveStrategyConfigParams<TConfig>): Promise<{
  config: TConfig;
  isConfigFromBacktest: boolean;
}> => {
  const mergeIfNotEmpty = <T extends object>(
    target: T,
    patch?: Partial<T> | null,
  ): T =>
    patch && !_.isEmpty(patch)
      ? ({
          ...target,
          ...patch,
        } as T)
      : target;

  let config = {
    ...defaults,
    ...baseConfig,
  } as TConfig;

  let isConfigFromBacktest = false;

  if (config.ENV !== 'BACKTEST') {
    const userConfig = (await getData(
      redisKeys.strategyConfig(userName, strategyName),
      {},
    )) as TConfig;
    config = mergeIfNotEmpty(config, userConfig);

    const results = (await getData(
      redisKeys.strategyResults(userName, strategyName),
      {},
    )) as StrategyResults;

    const backtestResult = results?.[symbol];
    if (backtestResult && !_.isEmpty(backtestResult.config)) {
      config = mergeIfNotEmpty(
        config,
        backtestResult.config as Partial<TConfig>,
      );
      isConfigFromBacktest = true;
    }
  }

  return { config, isConfigFromBacktest };
};
