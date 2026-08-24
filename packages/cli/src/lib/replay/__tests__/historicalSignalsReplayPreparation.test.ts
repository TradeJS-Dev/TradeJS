import type {
  KlineChartData,
  RuntimeLineage,
  StrategyConfig,
  StrategyCreator,
} from '@tradejs/types';
import { prepareHistoricalReplay } from '../historicalSignalsReplayPreparation';

const candle = (timestamp: number): KlineChartData[number] => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1,
  turnover: 100,
});

describe('historical replay preparation', () => {
  it('passes the embedded immutable config as the runtime config snapshot', async () => {
    const strategyConfig = {
      ENV: 'PRODUCTION',
      INTERVAL: '15',
      UNIVERSE: 'crypto',
      MAX_LOSS_VALUE: 1,
      MIN_AI_QUALITY: 4,
    } as StrategyConfig;
    const runtimeLineage: RuntimeLineage = {
      schemaVersion: 3,
      strategyRevision: 'sr1:1111111111111111',
      deploymentCompositionId: 'dc1:2222222222222222',
      strategyPackageVersion: '3.0.0',
      strategyDependencyVersions: { '@tradejs/core': '3.1.20' },
      runtimePackageVersion: '3.1.20',
      maxLossValue: 1,
    };
    const strategyCreator = jest.fn(async (params) => {
      if (!params.runtimeConfigSnapshot) {
        throw new Error(
          'Runtime strategy release snapshot is required for DoubleTap',
        );
      }
      return jest.fn();
    }) as jest.MockedFunction<StrategyCreator>;
    const candles = [candle(0), candle(1_000)];

    const plan = await prepareHistoricalReplay(
      {
        userName: 'root',
        projectRoot: '/project',
        preparedRun: {
          connectorName: 'bybit',
          marketConnector: {
            kline: jest.fn(async () => candles),
          },
          tickers: ['BTCUSDT'],
          instrumentsBySymbol: new Map(),
          window: { start: 1_000, end: 2_000, source: 'explicit' },
          preloadStart: 0,
          universe: 'crypto',
          accountId: 'bybit-default',
          deploymentId: 'production',
        },
        interval: '15',
        connectorName: 'bybit',
        replayConnector: {},
        strategies: [
          {
            strategyName: 'DoubleTap',
            strategyRevision: 'sr1:1111111111111111',
            deploymentCompositionId: 'dc1:2222222222222222',
            strategyPackage: '@tradejs/strategy-double-tap',
            strategyPackageVersion: '3.0.0',
            strategyDependencyVersions: { '@tradejs/core': '3.1.20' },
            runtimePackageVersion: '3.1.20',
            strategyCreator,
            strategyConfig,
            strategyResults: {},
          },
        ],
        references: {
          btcMarketData: candles,
          ethMarketData: candles,
          btcBinanceData: candles,
          btcCoinbaseData: candles,
        },
      } as unknown as Parameters<typeof prepareHistoricalReplay>[0],
      {
        progress: { tick: jest.fn() },
        display: {
          skipped: (value) => String(value),
          symbol: (value) => value,
        },
        buildLineage: jest.fn(async () => runtimeLineage),
      },
    );

    expect(plan.orderedTimestamps).toEqual([1_000]);
    const expectedReplayConfig = {
      ...strategyConfig,
      ENV: 'PARITY',
      INTERVAL: '15',
      MAKE_ORDERS: false,
      SIMULATE_ORDERS: true,
      RECORD_RUNTIME_TRADES: false,
    };
    expect(strategyCreator).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeConfigSnapshot: { userConfig: expectedReplayConfig },
        config: expectedReplayConfig,
      }),
    );
  });
});
