import {
  DEFAULT_RUNTIME_STRATEGY_MANAGED_PARAMETERS,
  mergeRuntimeStrategyManagedParameters,
  splitRuntimeStrategyConfig,
} from '../runtimeStrategyConfigForm';

describe('runtime strategy config form', () => {
  it('extracts managed fields from strategy parameters', () => {
    expect(
      splitRuntimeStrategyConfig({
        ENABLE: true,
        INTERVAL: '15',
        UNIVERSE: 'crypto',
        ACCOUNT_ID: 'bybit-main',
        MAX_LOSS_VALUE: 2,
        AI_ENABLED: false,
        AI_MODE: 'llm',
        MIN_AI_QUALITY: 5,
        ML_ENABLED: true,
        ML_THRESHOLD: 0.42,
        MA_FAST: 14,
      }),
    ).toEqual({
      managed: {
        maxLossValue: 2,
        aiEnabled: false,
        aiMode: 'llm',
        minAiQuality: 5,
        mlEnabled: true,
        mlThreshold: 0.42,
      },
      parameters: { MA_FAST: 14 },
    });
  });

  it('uses form defaults when creating a strategy config', () => {
    expect(splitRuntimeStrategyConfig(null)).toEqual({
      managed: DEFAULT_RUNTIME_STRATEGY_MANAGED_PARAMETERS,
      parameters: {},
    });
  });

  it('inserts managed fields back with typed values', () => {
    expect(
      mergeRuntimeStrategyManagedParameters(
        {
          MA_FAST: 14,
          AI_ENABLED: 'ignored JSON override',
        },
        {
          maxLossValue: 1,
          aiEnabled: true,
          aiMode: 'gate',
          minAiQuality: 4,
          mlEnabled: false,
          mlThreshold: 0.1,
        },
      ),
    ).toEqual({
      MA_FAST: 14,
      MAX_LOSS_VALUE: 1,
      AI_ENABLED: true,
      AI_MODE: 'gate',
      MIN_AI_QUALITY: 4,
      ML_ENABLED: false,
      ML_THRESHOLD: 0.1,
    });
  });
});
