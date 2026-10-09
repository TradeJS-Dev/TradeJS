jest.mock('@tradejs/infra/redis', () => ({
  setData: jest.fn(),
  redisKeys: { cacheOrders: jest.fn(), cachePositions: jest.fn() },
}));
jest.mock('@tradejs/infra/coreResearch', () => ({
  appendCoreResearchTraceEvent: jest.fn(),
}));

import { createStrategyAPI } from '@tradejs/core/strategies';
import { appendCoreResearchTraceEvent } from '@tradejs/infra/coreResearch';
import type { Connector, Signal, StrategyCreator, Test } from '@tradejs/types';
import { handleExitDecision } from '../../strategy/runtimeExecution';
import { createBacktestSession } from '../session';
import type { PreparedBacktestData } from '../contracts';

const candle = (timestamp: number, high = 106, low = 99) => ({
  dt: new Date(timestamp).toISOString(),
  timestamp,
  open: 100,
  high,
  low,
  close: 105,
  volume: 1,
  turnover: 100,
});

describe('strategy exits in backtest research evidence', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['explicit', 'exit', 'CHANNEL_BREAK_EXIT'],
    ['tp', 'take_profit', undefined],
    ['sl', 'stop_loss', undefined],
  ] as const)(
    'records a real %s completed trade in position_exited',
    async (mode, exitReason, exitCode) => {
      const entry = candle(1_000);
      const exit = candle(
        2_000,
        mode === 'tp' ? 120 : 106,
        mode === 'sl' ? 80 : 99,
      );
      const data = [entry, exit];
      const baseConnector = {
        kline: async () => [],
        getTickers: async () => [],
        getPositions: async () => [],
        getOpenPositionPnl: async () => 0,
      } as unknown as Connector;
      const strategyCreator: StrategyCreator = async ({ connector }) => {
        return async (current, btcCandle) => {
          if (current.timestamp === entry.timestamp) {
            const signal: Signal = {
              signalId: 'integration-entry',
              strategy: 'TrendLine',
              symbol: 'ETHUSDT',
              interval: '15',
              timestamp: entry.timestamp,
              direction: 'LONG',
              prices: {
                currentPrice: 100,
                takeProfitPrice: 110,
                stopLossPrice: 90,
                riskRatio: 1,
              },
              figures: {},
              indicators: {},
            };
            await connector.placeOrder({
              symbol: signal.symbol,
              qty: 1,
              price: 100,
              isLimit: false,
              timestamp: entry.timestamp,
              direction: 'LONG',
              signal,
            });
            await connector.setTakeProfits({
              symbol: signal.symbol,
              direction: 'LONG',
              takeProfits: [{ price: 110, rate: 1 }],
            });
            await connector.setStopLoss({
              symbol: signal.symbol,
              direction: 'LONG',
              stopLossPrice: 90,
            });
            return signal;
          }
          if (mode !== 'explicit') return 'NO_POSITION';
          const api = createStrategyAPI({
            strategy: 'TrendLine',
            symbol: 'ETHUSDT',
            interval: '15',
            env: 'BACKTEST',
            connector,
            cachedData: [current],
            isConfigFromBacktest: false,
          });
          const decision = await api.exit({
            code: 'CHANNEL_BREAK_EXIT',
            direction: 'LONG',
          });
          return handleExitDecision({
            connector,
            strategyName: 'TrendLine',
            symbol: 'ETHUSDT',
            decision,
            market: { candle: current, btcCandle },
          });
        };
      };
      const preparedData: PreparedBacktestData = {
        data,
        btcData: data,
        ethData: [],
        prevData: [],
        btcPrevData: [],
        ethPrevData: [],
        testData: data,
        btcTestData: data,
        ethTestData: [],
        btcBinanceData: [],
        btcCoinbaseData: [],
        backtestExecutionInterval: '15',
        backtestExecutionData: [],
        backtestExecutionBtcData: [],
        backtestExecutionDataByTimestamp: new Map(),
        backtestExecutionBtcDataByTimestamp: new Map(),
      };
      const session = await createBacktestSession({
        test: {
          userName: 'alice',
          testId: 'exit-integration',
          name: 'exit-integration',
          testSuiteId: 'exit-integration',
          strategyName: 'TrendLine',
          symbol: 'ETHUSDT',
          connectorName: 'ByBit',
          strategyConfig: { ENV: 'BACKTEST', INTERVAL: '15' },
          options: { start: entry.timestamp, end: exit.timestamp + 1 },
          researchTrace: true,
          fast: true,
          executionCostsCacheOnly: true,
        } as Test,
        connector: baseConnector,
        strategyCreator,
        preparedData,
        interval: '15',
        monitor: {
          run: async (_stage, action) => action(),
          runStrategy: async (_stage, action) => action(),
          contextStage: () => undefined,
        },
      });
      await session.next(entry, entry);
      await session.next(exit, exit);
      const result = await session.result();
      const events = jest
        .mocked(appendCoreResearchTraceEvent)
        .mock.calls.map(([call]) => JSON.parse(JSON.stringify(call.event)));
      const closed = events.filter(
        (event) => event.event === 'position_exited',
      );
      expect(closed).toHaveLength(1);
      expect(closed[0]).toMatchObject({
        signalId: 'integration-entry',
        exitReason,
      });
      if (exitCode) expect(closed[0].exitCode).toBe(exitCode);
      else expect(closed[0]).not.toHaveProperty('exitCode');
      expect(result.researchTraceSummary?.events.position_exited).toBe(1);
    },
  );
});
