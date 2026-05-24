import { Test } from '@tradejs/types';

const mockByBitConnector = {
  kline: jest.fn(),
};
const mockByBitConnectorCreator = jest.fn(async () => mockByBitConnector);
const mockBinanceConnector = {
  kline: jest.fn(),
};
const mockBinanceConnectorCreator = jest.fn(async () => mockBinanceConnector);
const mockCoinbaseConnector = {
  kline: jest.fn(),
};
const mockCoinbaseConnectorCreator = jest.fn(async () => mockCoinbaseConnector);
const mockAlignSortedCandlesByTimestamp = jest.fn(
  (coin: unknown[], btc: unknown[]) => ({
    alignedCoinCandles: coin,
    alignedBtcCandles: btc,
  }),
);

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
const mockBuildDefaultIndicatorPeriods = jest.fn((_config?: unknown) => ({
  maFast: 21,
}));
const mockBuildAiPayload: jest.Mock = jest.fn((_signal?: unknown) => ({
  signal: { strategy: 'TrendLine' },
  figures: {},
  indicators: {},
  additionalIndicators: {},
}));
const mockBuildMlTrainingRow: jest.Mock = jest.fn(() => ({ featureA: 1 }));
const mockAppendMlDatasetRow = jest.fn((_params?: unknown) => undefined);
const mockAppendAiDatasetRow = jest.fn((_params?: unknown) => undefined);
const mockPlanIndicatorCacheRestore = jest.fn(async (_params?: unknown) => ({
  paramsHash: 'hash-1',
  version: 'v3',
  restoreState: { runtimeState: true },
  replayStartIndex: 2,
  cached: false,
}));
const mockMaterializeIndicatorCachePlan = jest.fn(
  async (_params?: unknown) => undefined,
);
const mockEnrichSignalWithDerivativesContext = jest.fn(async (params: any) => {
  params.signal.additionalIndicators = {
    ...(params.signal.additionalIndicators ?? {}),
    baseContext: {
      ...(params.signal.additionalIndicators?.baseContext ?? {}),
      derivatives: {
        source: 'coinalyze',
        summary: { pressure: 'neutral', riskFlags: [] },
      },
    },
  };
  return true;
});
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
      return mockByBitConnectorCreator;
    }
    if (name === 'Binance') {
      return mockBinanceConnectorCreator;
    }
    if (name === 'Coinbase') {
      return mockCoinbaseConnectorCreator;
    }
    return undefined;
  },
}));

jest.mock('@tradejs/core/indicators', () => ({
  alignSortedCandlesByTimestamp: (coin: unknown[], btc: unknown[]) =>
    mockAlignSortedCandlesByTimestamp(coin, btc),
}));

jest.mock('@tradejs/core/strategies', () => ({
  buildDefaultIndicatorPeriods: (config: unknown) =>
    mockBuildDefaultIndicatorPeriods(config),
}));

jest.mock('../mlPayload', () => ({
  buildMlPayload: (payload: unknown) => mockBuildMlPayload(payload),
}));

jest.mock('../ai', () => ({
  buildAiPayload: (signal: unknown) => mockBuildAiPayload(signal),
}));

jest.mock('../strategyHelpers/derivativesContext', () => ({
  enrichSignalWithDerivativesContext: (params: unknown) =>
    mockEnrichSignalWithDerivativesContext(params),
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

jest.mock('../indicatorCache', () => ({
  planIndicatorCacheRestore: (params: unknown) =>
    mockPlanIndicatorCacheRestore(params),
  materializeIndicatorCachePlan: (params: unknown) =>
    mockMaterializeIndicatorCachePlan(params),
}));

jest.mock('@tradejs/core/time', () => ({
  getBacktestPreloadStart: (start: number, preloadDays = 30) =>
    Math.max(0, start - preloadDays * 24 * 60 * 60 * 1000),
  getTimestamp: () => 1_000_000,
}));

import {
  releaseTestingSymbolCache,
  resetTestingKlineCache,
  testing,
  warmBacktestIndicatorCache,
} from '../testing';

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
    mockByBitConnectorCreator.mockClear();
    mockBinanceConnectorCreator.mockClear();
    mockCoinbaseConnectorCreator.mockClear();
    mockAlignSortedCandlesByTimestamp.mockClear();
    mockStrategyCreator.mockClear();
    mockStrategy.mockReset();
    mockBuildAiPayload.mockClear();
    mockBuildDefaultIndicatorPeriods.mockClear();
    mockPlanIndicatorCacheRestore.mockClear();
    mockMaterializeIndicatorCachePlan.mockClear();
    mockEnrichSignalWithDerivativesContext.mockClear();
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

  afterEach(() => {
    jest.useRealTimers();
    process.send = undefined as any;
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

  it('loads kline data from the warmup window before test start', async () => {
    const start = Date.parse('2026-04-01T00:00:00.000Z');
    const end = Date.parse('2026-04-02T00:00:00.000Z');
    const expectedPreloadStart = start - 30 * 24 * 60 * 60 * 1000;
    const data = [
      candle(expectedPreloadStart),
      candle(start - 15 * 60 * 1000),
      candle(start),
      candle(start + 15 * 60 * 1000),
    ];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy.mockResolvedValue('HOLD');

    await testing(createTest({ options: { start, end } }));

    expect(mockByBitConnector.kline).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'ETHUSDT',
        start: expectedPreloadStart,
        end,
      }),
    );
  });

  it('passes full BTC reference data into strategy runtime for timestamp-safe spread resolution', async () => {
    const start = 1_000_200;
    const end = 1_000_500;
    const bybitData = [
      candle(1_000_050),
      candle(1_000_150),
      candle(1_000_250),
      candle(1_000_350),
    ];
    const binanceData = bybitData.map((item) => ({
      ...item,
      close: item.close + 10,
    }));
    const coinbaseData = bybitData.map((item) => ({
      ...item,
      close: item.close - 10,
    }));
    mockByBitConnector.kline.mockImplementation(({ symbol }: any) =>
      Promise.resolve(symbol === 'BTCUSDT' ? bybitData : bybitData),
    );
    mockBinanceConnector.kline.mockResolvedValue(binanceData);
    mockCoinbaseConnector.kline.mockResolvedValue(coinbaseData);
    mockStrategy.mockResolvedValue('HOLD');

    await testing(createTest({ options: { start, end } }));

    expect(mockStrategyCreator).toHaveBeenCalledWith(
      expect.objectContaining({
        data: bybitData.slice(0, 2),
        btcData: bybitData.slice(0, 2),
        btcBinanceData: binanceData,
        btcCoinbaseData: coinbaseData,
      }),
    );
  });

  it('warms indicator cache from aligned preload and test candles', async () => {
    const data = [
      candle(1_000_050),
      candle(1_000_150),
      candle(1_000_250),
      candle(1_000_350),
    ];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);

    const result = await warmBacktestIndicatorCache(createTest());

    expect(mockBuildDefaultIndicatorPeriods).toHaveBeenCalledWith({ a: 1 });
    expect(mockPlanIndicatorCacheRestore).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
        periods: { maFast: 21 },
        data,
        btcData: data,
        btcBinanceData: data,
        btcCoinbaseData: data,
      }),
    );
    expect(mockMaterializeIndicatorCachePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'ByBit',
        symbol: 'ETHUSDT',
        interval: 15,
        paramsHash: 'hash-1',
        restoreState: { runtimeState: true },
        replayStartIndex: 2,
        cached: false,
      }),
    );
    expect(result).toEqual({
      cached: false,
      replayStartIndex: 2,
      totalCandles: 4,
      paramsHash: 'hash-1',
      version: 'v3',
    });
  });

  it('releases symbol-scoped warmup data after cache materialization', async () => {
    const data = [
      candle(1_000_050),
      candle(1_000_150),
      candle(1_000_250),
      candle(1_000_350),
    ];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);

    await warmBacktestIndicatorCache(createTest());
    await warmBacktestIndicatorCache(createTest());

    expect(mockByBitConnectorCreator).toHaveBeenCalledTimes(1);
    expect(mockBinanceConnectorCreator).toHaveBeenCalledTimes(1);
    expect(mockCoinbaseConnectorCreator).toHaveBeenCalledTimes(1);
    expect(mockByBitConnector.kline).toHaveBeenCalledTimes(3);
    expect(mockBinanceConnector.kline).toHaveBeenCalledTimes(1);
    expect(mockCoinbaseConnector.kline).toHaveBeenCalledTimes(1);
    expect(mockPlanIndicatorCacheRestore).toHaveBeenCalledTimes(2);
    expect(mockMaterializeIndicatorCachePlan).toHaveBeenCalledTimes(2);
  });

  it('emits progress heartbeat while strategy signal is still running', async () => {
    jest.useFakeTimers();
    const send = jest.fn();
    process.send = send as any;
    const data = [candle(1_000_050), candle(1_000_150)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy.mockImplementation(
      () => new Promise<string>(() => undefined as never),
    );

    const runPromise = testing(createTest({ timeoutMs: 12_000 }));
    const rejection = expect(runPromise).rejects.toThrow(
      'Test ETH_suite_1 (ETHUSDT) timed out after 12000ms during strategy signal',
    );
    await jest.advanceTimersByTimeAsync(6_000);

    expect(send.mock.calls.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          progress: true,
          symbol: 'ETHUSDT',
          strategyName: 'TrendLine',
          stage: 'strategy signal',
          candleIndex: 1,
          candleTotal: 1,
        }),
      ]),
    );

    await jest.advanceTimersByTimeAsync(6_000);
    await rejection;
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
    expect(mockBuildMlPayload.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        signal: expect.objectContaining({
          additionalIndicators: expect.objectContaining({
            baseContext: expect.objectContaining({
              derivatives: expect.objectContaining({
                source: 'coinalyze',
              }),
            }),
          }),
        }),
      }),
    );
    expect(mockBuildMlTrainingRow).toHaveBeenCalledTimes(1);
    expect(mockAppendMlDatasetRow).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyName: 'TrendLine',
        chunkId: 'single',
        row: { featureA: 1 },
      }),
    );
  });

  it('writes compact AI payload row when strategy returns signal object', async () => {
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

    expect(mockBuildAiPayload).toHaveBeenCalledTimes(1);
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
          payload: expect.objectContaining({
            signal: expect.objectContaining({ strategy: 'TrendLine' }),
          }),
          profit: -3.5,
        }),
      }),
    );
  });

  it('still writes AI dataset rows in fast mode', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy
      .mockResolvedValueOnce({
        signalId: 's-fast',
        symbol: 'ETHUSDT',
        strategy: 'TrendLine',
        direction: 'LONG',
        timestamp: 1_000_150,
      })
      .mockResolvedValueOnce('HOLD');
    mockTestConnector.drainMlResultsBatch.mockResolvedValueOnce([
      { signalId: 's-fast', profit: 6.5 },
    ]);

    await testing(createTest({ ai: true, fast: true, chunkId: 'worker-fast' }));

    expect(mockAppendAiDatasetRow).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyName: 'TrendLine',
        chunkId: 'worker-fast',
        row: expect.objectContaining({
          signalId: 's-fast',
          symbol: 'ETHUSDT',
          profit: 6.5,
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

  it('does not collect replay signal evaluations by default', async () => {
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
      .mockResolvedValueOnce('NO_SIGNAL');

    const result = await testing(createTest());

    expect(result?.inlineReplaySignalEvaluations).toBeUndefined();
  });

  it('collects replay signal evaluations when explicitly requested', async () => {
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
      .mockResolvedValueOnce('NO_SIGNAL');

    const result = await testing(
      createTest({ collectReplaySignalEvaluations: true }),
    );

    expect(result?.inlineReplaySignalEvaluations).toEqual([
      expect.objectContaining({
        evaluationId: 's1:TrendLine:ETHUSDT:1000150',
        status: 'signal',
        signalId: 's1',
      }),
      expect.objectContaining({
        evaluationId: '1:TrendLine:ETHUSDT:1000250',
        status: 'skip',
        reason: 'NO_SIGNAL',
      }),
    ]);
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

  it('reuses prepared candle data and connector instances for identical tests', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy.mockResolvedValue('HOLD');

    await testing(createTest());
    await testing(createTest());

    expect(mockByBitConnectorCreator).toHaveBeenCalledTimes(1);
    expect(mockBinanceConnectorCreator).toHaveBeenCalledTimes(1);
    expect(mockCoinbaseConnectorCreator).toHaveBeenCalledTimes(1);
    expect(mockAlignSortedCandlesByTimestamp).toHaveBeenCalledTimes(3);
  });

  it('releases symbol-scoped candle caches without dropping shared connectors', async () => {
    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy.mockResolvedValue('HOLD');

    await testing(createTest());
    releaseTestingSymbolCache({
      userName: 'alice',
      connectorName: 'ByBit',
      symbol: 'ETHUSDT',
    });
    await testing(createTest());

    expect(mockByBitConnectorCreator).toHaveBeenCalledTimes(1);
    expect(mockBinanceConnectorCreator).toHaveBeenCalledTimes(1);
    expect(mockCoinbaseConnectorCreator).toHaveBeenCalledTimes(1);
    expect(mockByBitConnector.kline).toHaveBeenCalledTimes(3);
    expect(mockBinanceConnector.kline).toHaveBeenCalledTimes(1);
    expect(mockCoinbaseConnector.kline).toHaveBeenCalledTimes(1);
    expect(mockAlignSortedCandlesByTimestamp).toHaveBeenCalledTimes(6);
  });

  it('times out a slow test item with symbol in the error message', async () => {
    jest.useFakeTimers();

    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('HOLD'), 100);
        }),
    );

    const promise = testing(createTest({ timeoutMs: 10 }));
    const rejection = expect(promise).rejects.toThrow(
      'Test ETH_suite_1 (ETHUSDT) timed out after 10ms during strategy signal',
    );
    await jest.advanceTimersByTimeAsync(20);
    await rejection;

    jest.useRealTimers();
  });

  it('does not apply the item timeout as a total runtime cap', async () => {
    jest.useFakeTimers();

    const data = [candle(1_000_050), candle(1_000_150), candle(1_000_250)];
    mockByBitConnector.kline.mockResolvedValue(data);
    mockBinanceConnector.kline.mockResolvedValue(data);
    mockCoinbaseConnector.kline.mockResolvedValue(data);
    mockStrategy.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('HOLD'), 6);
        }),
    );

    const promise = testing(createTest({ timeoutMs: 10 }));
    await jest.advanceTimersByTimeAsync(50);

    await expect(promise).resolves.toEqual(
      expect.objectContaining({
        orderLogId: 'log-1',
      }),
    );

    jest.useRealTimers();
  });
});
