import _ from 'lodash';
import {
  getRuntimeStrategyConfig,
  getRuntimeStrategyResultConfig,
} from '@tradejs/infra/runtimeStrategyConfigs';
import { RuntimeStrategyConfigSnapshot, StrategyConfig } from '@tradejs/types';

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
        : (await getRuntimeStrategyConfig(
            userName,
            strategyName,
            runtimeConfigId,
          )) ?? {}
    ) as TConfig;
    config = mergeIfNotEmpty(config, userConfig);

    if (!runtimeConfigId || runtimeConfigId === 'config') {
      const symbolResultConfig = runtimeConfigSnapshot
        ? runtimeConfigSnapshot.symbolResultConfig
        : await getRuntimeStrategyResultConfig(userName, strategyName, symbol);
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
