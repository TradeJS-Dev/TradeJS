import _ from 'lodash';
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
  baseConfig,
  defaults,
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
    if (!runtimeConfigSnapshot) {
      throw new Error(
        `Runtime strategy release snapshot is required for ${strategyName}`,
      );
    }
    const userConfig = runtimeConfigSnapshot.userConfig as TConfig;
    config = mergeIfNotEmpty(config, userConfig);
  }

  return { config, isConfigFromBacktest };
};
