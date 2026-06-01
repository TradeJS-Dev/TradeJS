import { buildRuntimeModeStrategyConfig } from '../lib/runtimeModeConfig';

describe('runtimeModeConfig', () => {
  it('builds replay/parity config with runtime trade recording disabled', () => {
    expect(
      buildRuntimeModeStrategyConfig({
        strategyConfig: { AI_ENABLED: true },
        env: 'PARITY',
        interval: '15',
        makeOrders: true,
        recordRuntimeTrades: false,
      }),
    ).toEqual({
      AI_ENABLED: true,
      ENV: 'PARITY',
      INTERVAL: '15',
      MAKE_ORDERS: true,
      RECORD_RUNTIME_TRADES: false,
    });
  });

  it('keeps CRON MAKE_ORDERS explicit even when undefined', () => {
    expect(
      buildRuntimeModeStrategyConfig({
        strategyConfig: { MAKE_ORDERS: false },
        env: 'CRON',
        interval: '60',
        makeOrders: undefined,
      }),
    ).toEqual({
      ENV: 'CRON',
      INTERVAL: '60',
      MAKE_ORDERS: undefined,
    });
  });

  it('adds replay AI analyses only when present', () => {
    const base = {
      strategyConfig: {},
      env: 'BACKTEST' as const,
      interval: '15' as const,
      makeOrders: true,
    };

    expect(buildRuntimeModeStrategyConfig(base)).not.toHaveProperty(
      'AI_REPLAY_ANALYSES',
    );
    expect(
      buildRuntimeModeStrategyConfig({
        ...base,
        aiReplayAnalyses: [{ id: 'analysis-1' }],
      }).AI_REPLAY_ANALYSES,
    ).toEqual([{ id: 'analysis-1' }]);
  });
});
