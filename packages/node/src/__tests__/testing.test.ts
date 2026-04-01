import { Test } from '@tradejs/types';

const mockByBitConnector = {
  kline: jest.fn(),
};
const mockBinanceConnector = {
  kline: jest.fn(),
};
const mockCoinbaseConnector = {
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
const mockBuildAiPrompts: jest.Mock = jest.fn((_signal?: unknown) => ({
  systemPrompt: 'system prompt',
  humanPrompt: 'human prompt',
}));
const mockBuildMlTrainingRow: jest.Mock = jest.fn(() => ({ featureA: 1 }));
const mockAppendMlDatasetRow = jest.fn((_params?: unknown) => undefined);
const mockAppendAiDatasetRow = jest.fn((_params?: unknown) => undefined);
const originalProjectCwd = process.env.PROJECT_CWD;

jest.mock('../tradejsConfig', () => ({
  getTradejsProjectCwd: (cwd?: string) =>
    cwd || process.env.PROJECT_CWD || '/tmp/project-default',
}));

jest.mock('../strategy/manifests', () => ({
  getStrategyCreator: async (strategyName: string) =>
    strategyName === 'TrendLine'
      ? (config: unknown) => mockStrategyCreator(config)
      : undefined,
}));

jest.mock('../testConnector', () => ({
  createTestConnector: () => mockTestConnector,
}));

jest.mock('../connectorsRegistry', () => ({
  BUILTIN_CONNECTOR_NAMES: {
    ByBit: 'ByBit',
    Binance: 'Binance',
    Coinbase: 'Coinbase',
    Test: 'Test',
  },
  getConnectorCreatorByName: async (name: string) => {
    if (name === 'ByBit') {
      return async () => mockByBitConnector;
    }
    if (name === 'Binance') {
      return async () => mockBinanceConnector;
    }
    if (name === 'Coinbase') {
      return async () => mockCoinbaseConnector;
    }
    return undefined;
  },
}));

jest.mock('@tradejs/core/indicators', () => ({
  alignSortedCandlesByTimestamp: (coin: unknown[], btc: unknown[]) => ({
    alignedCoinCandles: coin,
    alignedBtcCandles: btc,
  }),
}));

jest.mock('../mlPayload', () => ({
  buildMlPayload: (payload: unknown) => mockBuildMlPayload(payload),
}));

jest.mock('../ai', () => ({
  buildAiPrompts: (signal: unknown) => mockBuildAiPrompts(signal),
}));

jest.mock('@tradejs/infra/ai', () => ({
  appendAiDatasetRow: (params: unknown) => mockAppendAiDatasetRow(params),
}));

jest.mock('@tradejs/infra/ml', () => ({
  buildMlTrainingRow: (signalRecord: unknown, resultRecord: unknown) =>
    mockBuildMlTrainingRow(signalRecord, resultRecord),
  trimMlTrainingRowWindows: (row: unknown) => row,
  appendMlDatasetRow: (params: unknown) => mockAppendMlDatasetRow(params),
}));

jest.mock('@tradejs/core/time', () => ({
  getTimestamp: () => 1_000_000,
}));

import { testing, resetTestingKlineCache } from '../testing';

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
    process.env.PROJECT_CWD = '/tmp/project-default';
    resetTestingKlineCache();
    jest.clearAllMocks();
    mockByBitConnector.kline.mockReset();
    mockBinanceConnector.kline.mockReset();
    mockCoinbaseConnector.kline.mockReset();
    mockStrategyCreator.mockClear();
    mockStrategy.mockReset();
    mockBuildAiPrompts.mockClear();
    mockTestConnector.checkSl.mockClear();
    mockTestConnector.checkTp.mockClear();
    mockTestConnector.drainMlResultsBatch.mockReset();
    mockTestConnector.drainMlResultsBatch.mockResolvedValue([]);
    mockTestConnector.getResult.mockResolvedValue({
      orderLogId: 'log-1',
      stat: { amount: 110, profit: 10, orders: 1 },
    });
  });

  afterAll(() => {
    if (originalProjectCwd == null) {
      delete process.env.PROJECT_CWD;
      return;
    }

    process.env.PROJECT_CWD = originalProjectCwd;
  });

  it('throws when start is missing', async () => {
    await expect(
      testing(createTest({ options: { start: undefined, end: 1_000_500 } })),
    ).rejects.toThrow('no start');
  });

  it('calls checkSl/checkTp for each test candle', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy.mockResolvedValue('HOLD');

    await testing(createTest({ ml: true }));

    expect(mockByBitConnector.kline).toHaveBeenCalledTimes(2);
    expect(mockTestConnector.checkSl).toHaveBeenCalledTimes(2);
    expect(mockTestConnector.checkTp).toHaveBeenCalledTimes(2);
  });

  it('writes transformed ml row when strategy returns signal object', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy
      .mockResolvedValueOnce({
        signalId: 's1',
        symbol: 'ETHUSDT',
      })
      .mockResolvedValueOnce('HOLD');
    mockTestConnector.drainMlResultsBatch.mockResolvedValueOnce([
      { signalId: 's1', profit: 2.5 },
    ]);

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

  it('writes AI prompt row when strategy returns signal object', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy
      .mockResolvedValueOnce({
        signalId: 's1',
        symbol: 'ETHUSDT',
        strategy: 'TrendLine',
        direction: 'LONG',
        timestamp: 1_000_150,
      })
      .mockResolvedValueOnce('HOLD');
    mockTestConnector.drainMlResultsBatch.mockResolvedValueOnce([
      { signalId: 's1', profit: -3.5 },
    ]);

    await testing(createTest({ ai: true, chunkId: 'worker-7' }));

    expect(mockBuildAiPrompts).toHaveBeenCalledTimes(1);
    expect(mockAppendAiDatasetRow).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyName: 'TrendLine',
        chunkId: 'worker-7',
        row: expect.objectContaining({
          signalId: 's1',
          symbol: 'ETHUSDT',
          strategyName: 'TrendLine',
          direction: 'LONG',
          timestamp: 1_000_150,
          systemPrompt: 'system prompt',
          humanPrompt: 'human prompt',
          profit: -3.5,
        }),
      }),
    );
  });

  it('does not write ml row when strategy returns string', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy.mockResolvedValue('NO_SIGNAL');

    await testing(createTest());

    expect(mockAppendMlDatasetRow).not.toHaveBeenCalled();
    expect(mockAppendAiDatasetRow).not.toHaveBeenCalled();
  });

  it('does not pass legacy candle arrays into ml payload builder', async () => {
    const prev = Array.from({ length: 60 }, (_, i) => candle(1_000_000 + i));
    const testPart = [candle(2_000_200)];
    mockByBitConnector.kline.mockResolvedValue([...prev, ...testPart]);
    mockBinanceConnector.kline.mockResolvedValue([...prev, ...testPart]);
    mockCoinbaseConnector.kline.mockResolvedValue([...prev, ...testPart]);
    mockStrategy.mockResolvedValue({
      signalId: 's1',
      symbol: 'ETHUSDT',
    });
    mockTestConnector.drainMlResultsBatch.mockResolvedValueOnce([
      { signalId: 's1', profit: 1.1 },
    ]);

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
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy
      .mockResolvedValueOnce({ signalId: 's1', symbol: 'ETHUSDT' })
      .mockResolvedValueOnce({ signalId: 's2', symbol: 'ETHUSDT' })
      .mockResolvedValueOnce('HOLD');
    mockTestConnector.drainMlResultsBatch.mockResolvedValueOnce([
      { signalId: 's2', profit: 2.2 },
      { signalId: 's1', profit: -1.1 },
    ]);
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

  it('keeps kline cache isolated per project root and supports scoped reset', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy.mockResolvedValue('HOLD');

    process.env.PROJECT_CWD = '/tmp/project-a';
    await testing(createTest());

    expect(mockByBitConnector.kline).toHaveBeenCalledTimes(2);
    expect(mockBinanceConnector.kline).toHaveBeenCalledTimes(1);
    expect(mockCoinbaseConnector.kline).toHaveBeenCalledTimes(1);

    process.env.PROJECT_CWD = '/tmp/project-b';
    await testing(createTest());

    expect(mockByBitConnector.kline).toHaveBeenCalledTimes(4);
    expect(mockBinanceConnector.kline).toHaveBeenCalledTimes(2);
    expect(mockCoinbaseConnector.kline).toHaveBeenCalledTimes(2);

    resetTestingKlineCache('/tmp/project-a');

    process.env.PROJECT_CWD = '/tmp/project-b';
    await testing(createTest());

    expect(mockByBitConnector.kline).toHaveBeenCalledTimes(4);
    expect(mockBinanceConnector.kline).toHaveBeenCalledTimes(2);
    expect(mockCoinbaseConnector.kline).toHaveBeenCalledTimes(2);

    process.env.PROJECT_CWD = '/tmp/project-a';
    await testing(createTest());

    expect(mockByBitConnector.kline).toHaveBeenCalledTimes(6);
    expect(mockBinanceConnector.kline).toHaveBeenCalledTimes(3);
    expect(mockCoinbaseConnector.kline).toHaveBeenCalledTimes(3);
  });
});
