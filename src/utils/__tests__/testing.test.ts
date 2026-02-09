import { Test } from '@types';
import { ML_BASE_CANDLES_WINDOW } from '@constants';

const mockByBitConnector = {
  kline: jest.fn(),
};

const mockTestConnector = {
  checkSl: jest.fn().mockResolvedValue(undefined),
  checkTp: jest.fn().mockResolvedValue(undefined),
  getResult: jest.fn().mockResolvedValue({
    orderLogId: 'log-1',
    stat: { amount: 110, profit: 10, orders: 1 },
  }),
};

const mockStrategy = jest.fn();
const mockStrategyCreator = jest.fn(async (_config?: unknown) => mockStrategy);
const mockSetData = jest.fn();
const mockBuildMlPayload = jest.fn((data) => data);

jest.mock('@src/connectors', () => ({
  connectors: {
    ByBit: jest.fn(async () => mockByBitConnector),
    Test: jest.fn(() => mockTestConnector),
  },
  ConnectorNames: {
    ByBit: 'ByBit',
    Test: 'Test',
  },
}));

jest.mock('@src/strategy', () => ({
  strategies: {
    TrendLine: (config: unknown) => mockStrategyCreator(config),
  },
  StrategyNames: {
    TrendLine: 'TrendLine',
  },
}));

jest.mock('@utils/correlation', () => ({
  alignSortedCandlesByTimestamp: (coin: unknown[], btc: unknown[]) => ({
    alignedCoinCandles: coin,
    alignedBtcCandles: btc,
  }),
}));

jest.mock('@utils/redis', () => ({
  setData: (...args: unknown[]) => mockSetData(...args),
  redisKeys: {
    mlSignal: (strategyName: string, signalId: string) =>
      `ml:${strategyName}:signals:${signalId}`,
  },
}));

jest.mock('@utils/mlPayload', () => ({
  buildMlPayload: (payload: unknown) => mockBuildMlPayload(payload),
}));

jest.mock('@utils/timestamp', () => ({
  getTimestamp: () => 1_000_000,
}));

import { testing } from '@utils/testing';

const candle = (timestamp: number) => ({
  timestamp,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1,
  turnover: 1,
  dt: String(timestamp),
});

const createTest = (overrides: Partial<Test> = {}): Test =>
  ({
    userName: 'alice',
    symbol: 'ETHUSDT',
    options: { start: 1_000_100, end: 1_000_500 },
    name: 'ETH_suite_1',
    testId: '1',
    testSuiteId: 'suite',
    strategyName: 'TrendLine',
    strategyConfig: { a: 1 },
    connectorName: 'ByBit',
    ...overrides,
  }) as Test;

describe('testing backtest flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockByBitConnector.kline.mockReset();
    mockStrategyCreator.mockClear();
    mockStrategy.mockReset();
    mockTestConnector.checkSl.mockClear();
    mockTestConnector.checkTp.mockClear();
    mockTestConnector.getResult.mockResolvedValue({
      orderLogId: 'log-1',
      stat: { amount: 110, profit: 10, orders: 1 },
    });
  });

  it('throws when start is missing', async () => {
    await expect(
      testing(createTest({ options: { start: undefined, end: 1_000_500 } })),
    ).rejects.toThrow('no start');
  });

  it('calls checkSl/checkTp for each test candle', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockStrategy.mockResolvedValue('HOLD');

    await testing(createTest({ ml: true }));

    expect(mockByBitConnector.kline).toHaveBeenCalledTimes(2);
    expect(mockTestConnector.checkSl).toHaveBeenCalledTimes(2);
    expect(mockTestConnector.checkTp).toHaveBeenCalledTimes(2);
  });

  it('stores ml signal when strategy returns signal object', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockStrategy
      .mockResolvedValueOnce({
        signalId: 's1',
        symbol: 'ETHUSDT',
      })
      .mockResolvedValueOnce('HOLD');

    await testing(createTest({ ml: true }));

    expect(mockSetData).toHaveBeenCalledTimes(1);
    expect(mockSetData).toHaveBeenCalledWith(
      'ml:TrendLine:signals:s1',
      expect.anything(),
      expect.objectContaining({ expire: expect.any(Number) }),
    );
  });

  it('does not store ml signal when strategy returns string', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockStrategy.mockResolvedValue('NO_SIGNAL');

    await testing(createTest());

    expect(mockSetData).not.toHaveBeenCalled();
  });

  it('limits ml payload candle history to configured ML window', async () => {
    const prev = Array.from(
      { length: ML_BASE_CANDLES_WINDOW + 10 },
      (_, i) => candle(1_000_000 + i),
    );
    const testPart = [candle(2_000_200)];
    mockByBitConnector.kline.mockResolvedValue([...prev, ...testPart]);
    mockStrategy.mockResolvedValue({
      signalId: 's1',
      symbol: 'ETHUSDT',
    });

    await testing(
      createTest({
        options: { start: 2_000_200, end: 2_000_500 },
        ml: true,
      }),
    );

    expect(mockBuildMlPayload).toHaveBeenCalledTimes(1);
    const payloadArg = mockBuildMlPayload.mock.calls[0][0];
    expect(payloadArg.candles).toHaveLength(ML_BASE_CANDLES_WINDOW);
    expect(payloadArg.btcCandles).toHaveLength(ML_BASE_CANDLES_WINDOW);
  });
});
