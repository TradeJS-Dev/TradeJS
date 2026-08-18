import { resolveStrategyConfig } from '../strategyHelpers/config';

describe('resolveStrategyConfig runtime snapshots', () => {
  it('merges defaults, invocation config, and one immutable release snapshot', async () => {
    const result = await resolveStrategyConfig({
      strategyName: 'TrendLine',
      userName: 'root',
      symbol: 'ETHUSDT',
      defaults: {
        ENV: 'BACKTEST',
        DEFAULT_ONLY: true,
        OVERLAP: 'default',
      },
      baseConfig: {
        ENV: 'CRON',
        BASE_ONLY: true,
        OVERLAP: 'base',
      },
      runtimeConfigSnapshot: {
        userConfig: {
          USER_ONLY: true,
          OVERLAP: 'user',
        },
      },
    });

    expect(result).toEqual({
      config: {
        ENV: 'CRON',
        DEFAULT_ONLY: true,
        BASE_ONLY: true,
        USER_ONLY: true,
        OVERLAP: 'user',
      },
      isConfigFromBacktest: false,
    });
  });

  it('rejects non-backtest execution without a release snapshot', async () => {
    await expect(
      resolveStrategyConfig({
        strategyName: 'TrendLine',
        userName: 'root',
        symbol: 'ETHUSDT',
        defaults: { ENV: 'BACKTEST' },
        baseConfig: { ENV: 'REPLAY' },
      }),
    ).rejects.toThrow(
      'Runtime strategy release snapshot is required for TrendLine',
    );
  });

  it('never consults runtime snapshots in backtest mode', async () => {
    const result = await resolveStrategyConfig({
      strategyName: 'TrendLine',
      userName: 'root',
      symbol: 'ETHUSDT',
      defaults: { ENV: 'BACKTEST', VALUE: 'default' },
      baseConfig: { ENV: 'BACKTEST', VALUE: 'base' },
      runtimeConfigSnapshot: {
        userConfig: { VALUE: 'runtime' },
      },
    });

    expect(result).toEqual({
      config: { ENV: 'BACKTEST', VALUE: 'base' },
      isConfigFromBacktest: false,
    });
  });
});
