import { Test } from '@types';

const mockByBitConnector = {
  kline: jest.fn(),
};

const mockTestConnector = {
  checkSl: jest.fn().mockResolvedValue(undefined),
  checkTp: jest.fn().mockResolvedValue(undefined),
  drainMlResultsBatch: jest.fn().mockResolvedValue([]),
  getResult: jest.fn().mockResolvedValue({
    orderLogId: 'log-1',
    stat: { amount: 110, profit: 10, orders: 1 },
  }),
};

const mockStrategy = jest.fn();
const mockStrategyCreator = jest.fn(async (_config?: unknown) => mockStrategy);
const mockBuildMlPayload = jest.fn((data) => data);
const mockBuildMlTrainingRow: jest.Mock = jest.fn(
  (_signalRecord?: unknown, _resultRecord?: unknown) => ({ featureA: 1 }),
);
const mockAppendMlDatasetRow = jest.fn((_params?: unknown) => undefined);

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

jest.mock('@utils/mlPayload', () => ({
  buildMlPayload: (payload: unknown) => mockBuildMlPayload(payload),
}));

jest.mock('@utils/mlTrainingTransform', () => ({
  buildMlTrainingRow: (signalRecord: unknown, resultRecord: unknown) =>
    mockBuildMlTrainingRow(signalRecord, resultRecord),
  trimMlTrainingRowWindows: (row: unknown) => row,
}));

jest.mock('@utils/mlDatasetFile', () => ({
  appendMlDatasetRow: (params: unknown) => mockAppendMlDatasetRow(params),
}));

jest.mock('@utils/timestamp', () => ({
  getTimestamp: () => 1_000_000,
}));

import { testing, resetTestingKlineCache } from '@utils/testing';

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
    resetTestingKlineCache();
    jest.clearAllMocks();
    mockByBitConnector.kline.mockReset();
    mockStrategyCreator.mockClear();
    mockStrategy.mockReset();
    mockTestConnector.checkSl.mockClear();
    mockTestConnector.checkTp.mockClear();
    mockTestConnector.drainMlResultsBatch.mockReset();
    mockTestConnector.drainMlResultsBatch.mockResolvedValue([]);
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

  it('writes transformed ml row when strategy returns signal object', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockStrategy
      .mockResolvedValueOnce({
        signalId: 's1',
        symbol: 'ETHUSDT',
      })
      .mockResolvedValueOnce('HOLD');
    mockTestConnector.drainMlResultsBatch
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ signalId: 's1', profit: 2.5 }])
      .mockResolvedValue([]);

    await testing(createTest({ ml: true }));

    expect(mockBuildMlPayload).toHaveBeenCalledTimes(1);
    expect(mockBuildMlTrainingRow).toHaveBeenCalledTimes(1);
    expect(mockAppendMlDatasetRow).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyName: 'TrendLine',
        chunkId: 'single',
        row: { featureA: 1 },
      }),
    );
  });

  it('does not write ml row when strategy returns string', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockStrategy.mockResolvedValue('NO_SIGNAL');

    await testing(createTest());

    expect(mockAppendMlDatasetRow).not.toHaveBeenCalled();
  });

  it('does not pass legacy candle arrays into ml payload builder', async () => {
    const prev = Array.from({ length: 60 }, (_, i) => candle(1_000_000 + i));
    const testPart = [candle(2_000_200)];
    mockByBitConnector.kline.mockResolvedValue([...prev, ...testPart]);
    mockStrategy.mockResolvedValue({
      signalId: 's1',
      symbol: 'ETHUSDT',
    });
    mockTestConnector.drainMlResultsBatch
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ signalId: 's1', profit: 1.1 }]);

    await testing(
      createTest({
        options: { start: 2_000_200, end: 2_000_500 },
        ml: true,
        chunkId: 'worker-2',
      }),
    );

    expect(mockBuildMlPayload).toHaveBeenCalledTimes(1);
    const payloadArg = mockBuildMlPayload.mock.calls[0][0];
    expect(payloadArg.candles).toBeUndefined();
    expect(payloadArg.btcCandles).toBeUndefined();
    expect(mockAppendMlDatasetRow).toHaveBeenCalledWith(
      expect.objectContaining({ chunkId: 'worker-2' }),
    );
  });

  it('matches ml results to pending payload by signalId for batched exits', async () => {
    const data = [
      candle(1_000_050),
      candle(1_000_150),
      candle(1_000_250),
      candle(1_000_350),
    ];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockStrategy
      .mockResolvedValueOnce({ signalId: 's1', symbol: 'ETHUSDT' })
      .mockResolvedValueOnce({ signalId: 's2', symbol: 'ETHUSDT' })
      .mockResolvedValueOnce('HOLD');
    mockTestConnector.drainMlResultsBatch
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { signalId: 's2', profit: 2.2 },
        { signalId: 's1', profit: -1.1 },
      ])
      .mockResolvedValue([]);
    mockBuildMlTrainingRow.mockImplementation(
      (signalRecord: any, resultRecord: any) => ({
        signalId: signalRecord?.signal?.signalId,
        profit: resultRecord?.profit,
      }),
    );

    await testing(createTest({ ml: true }));

    expect(mockBuildMlPayload).toHaveBeenCalledTimes(2);
    expect(mockBuildMlTrainingRow).toHaveBeenCalledTimes(2);
    expect(mockBuildMlTrainingRow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        signal: expect.objectContaining({ signalId: 's2' }),
      }),
      expect.objectContaining({ profit: 2.2 }),
    );
    expect(mockBuildMlTrainingRow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        signal: expect.objectContaining({ signalId: 's1' }),
      }),
      expect.objectContaining({ profit: -1.1 }),
    );
    expect(mockAppendMlDatasetRow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        row: expect.objectContaining({ signalId: 's2', profit: 2.2 }),
      }),
    );
    expect(mockAppendMlDatasetRow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        row: expect.objectContaining({ signalId: 's1', profit: -1.1 }),
      }),
    );
  });
});
mockBuildMlTrainingRow.mockClear();
mockAppendMlDatasetRow.mockClear();
