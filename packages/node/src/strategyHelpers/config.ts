import _ from 'lodash';
import { getData, redisKeys } from '@tradejs/infra/redis';
import {
  RuntimeStrategyConfigSnapshot,
  StrategyConfig,
  StrategyResults,
} from '@tradejs/types';

interface ResolveStrategyConfigParams<TConfig extends StrategyConfig> {
  strategyName: string;
  userName: string;
  symbol: string;
  baseConfig: Record<string, any>;
  defaults: TConfig;
  runtimeConfigId?: string;
  runtimeConfigSnapshot?: RuntimeStrategyConfigSnapshot;
}

export const resolveStrategyConfig = async <TConfig extends StrategyConfig>({
  strategyName,
  userName,
  symbol,
  baseConfig,
  defaults,
  runtimeConfigId,
  runtimeConfigSnapshot,
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
    const userConfig = (
      runtimeConfigSnapshot
        ? runtimeConfigSnapshot.userConfig
        : await getData(
            runtimeConfigId
              ? redisKeys.strategyConfig(
                  userName,
                  strategyName,
                  runtimeConfigId,
                )
              : redisKeys.strategyConfig(userName, strategyName),
            {},
          )
    ) as TConfig;
    config = mergeIfNotEmpty(config, userConfig);

    if (!runtimeConfigId || runtimeConfigId === 'config') {
      const symbolResultConfig = runtimeConfigSnapshot
        ? runtimeConfigSnapshot.symbolResultConfig
        : (
            (await getData(
              redisKeys.strategyResults(userName, strategyName),
              {},
            )) as StrategyResults
          )?.[symbol]?.config;
      if (symbolResultConfig && !_.isEmpty(symbolResultConfig)) {
        config = mergeIfNotEmpty(
          config,
          symbolResultConfig as Partial<TConfig>,
        );
        isConfigFromBacktest = true;
      }
    }
  }

  return { config, isConfigFromBacktest };
};
