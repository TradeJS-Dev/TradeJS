const getRuntimeStrategyConfig = jest.fn();
const getRuntimeStrategyResultConfig = jest.fn();

jest.mock('@tradejs/infra/runtimeStrategyConfigs', () => ({
  getRuntimeStrategyConfig: (...args: unknown[]) =>
    getRuntimeStrategyConfig(...args),
  getRuntimeStrategyResultConfig: (...args: unknown[]) =>
    getRuntimeStrategyResultConfig(...args),
}));

import { resolveStrategyConfig } from '../strategyHelpers/config';

describe('resolveStrategyConfig runtime snapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves runtime merge order without rereading Redis', async () => {
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
      runtimeConfigId: 'config',
      runtimeConfigSnapshot: {
        userConfig: {
          USER_ONLY: true,
          OVERLAP: 'user',
        },
        symbolResultConfig: {
          RESULT_ONLY: true,
          OVERLAP: 'result',
        },
      },
    });

    expect(result).toEqual({
      config: {
        ENV: 'CRON',
        DEFAULT_ONLY: true,
        BASE_ONLY: true,
        USER_ONLY: true,
        RESULT_ONLY: true,
        OVERLAP: 'result',
      },
      isConfigFromBacktest: true,
    });
    expect(getRuntimeStrategyConfig).not.toHaveBeenCalled();
    expect(getRuntimeStrategyResultConfig).not.toHaveBeenCalled();
  });

  it('keeps named configs isolated from symbol result configs', async () => {
    const result = await resolveStrategyConfig({
      strategyName: 'TrendLine',
      userName: 'root',
      symbol: 'ETHUSDT',
      defaults: { ENV: 'BACKTEST' },
      baseConfig: { ENV: 'CRON', VALUE: 'base' },
      runtimeConfigId: 'live-a',
      runtimeConfigSnapshot: {
        userConfig: { VALUE: 'named' },
        symbolResultConfig: { VALUE: 'result' },
      },
    });

    expect(result).toEqual({
      config: { ENV: 'CRON', VALUE: 'named' },
      isConfigFromBacktest: false,
    });
    expect(getRuntimeStrategyConfig).not.toHaveBeenCalled();
    expect(getRuntimeStrategyResultConfig).not.toHaveBeenCalled();
  });

  it('retains Redis loading for replay and other callers without a snapshot', async () => {
    getRuntimeStrategyConfig.mockResolvedValueOnce({ VALUE: 'user' });
    getRuntimeStrategyResultConfig.mockResolvedValueOnce({ VALUE: 'result' });

    const result = await resolveStrategyConfig({
      strategyName: 'TrendLine',
      userName: 'root',
      symbol: 'ETHUSDT',
      defaults: { ENV: 'BACKTEST' },
      baseConfig: { ENV: 'REPLAY', VALUE: 'base' },
      runtimeConfigId: 'config',
    });

    expect(result).toEqual({
      config: { ENV: 'REPLAY', VALUE: 'result' },
      isConfigFromBacktest: true,
    });
    expect(getRuntimeStrategyConfig).toHaveBeenCalledTimes(1);
    expect(getRuntimeStrategyResultConfig).toHaveBeenCalledTimes(1);
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
        symbolResultConfig: { VALUE: 'result' },
      },
    });

    expect(result).toEqual({
      config: { ENV: 'BACKTEST', VALUE: 'base' },
      isConfigFromBacktest: false,
    });
    expect(getRuntimeStrategyConfig).not.toHaveBeenCalled();
    expect(getRuntimeStrategyResultConfig).not.toHaveBeenCalled();
  });
});
