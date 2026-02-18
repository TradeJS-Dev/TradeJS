const mockPredict = jest.fn();
const mockMlInferCtor = jest.fn(() => ({ Predict: mockPredict }));

jest.mock('@grpc/proto-loader', () => ({
  loadSync: jest.fn(() => ({})),
}));

jest.mock('@grpc/grpc-js', () => ({
  credentials: {
    createInsecure: jest.fn(() => ({})),
  },
  loadPackageDefinition: jest.fn(() => ({
    ml_infer: {
      MlInfer: mockMlInferCtor,
    },
  })),
}));

const mockBuildMlPayload = jest.fn((payload) => payload);
const mockBuildMlTrainingRow = jest.fn();
const mockTrimMlTrainingRowWindows = jest.fn();

jest.mock('@utils/mlPayload', () => ({
  buildMlPayload: (payload: unknown) => mockBuildMlPayload(payload),
}));

jest.mock('@utils/mlTrainingTransform', () => ({
  buildMlTrainingRow: (signalRecord: unknown, resultRecord: unknown) =>
    mockBuildMlTrainingRow(signalRecord, resultRecord),
  trimMlTrainingRowWindows: (row: unknown, keep: number) =>
    mockTrimMlTrainingRowWindows(row, keep),
}));

jest.mock('@utils/logger', () => ({
  logger: {
    error: jest.fn(),
  },
}));

import { fetchMlThreshold } from '@utils/mlGrpc';

describe('mlGrpc', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPredict.mockImplementation(
      (
        _req: unknown,
        callback: (err: Error | null, response: unknown) => void,
      ) => {
        callback(null, { probability: 0.7, threshold: 0.4, passed: true });
      },
    );
  });

  test('fetchMlThreshold trims feature windows before grpc predict', async () => {
    const fullRow = {
      TF15M_Price1hPcnt_49: 1.23,
      TF15M_Price1hPcnt_50: 4.56,
      label: 1,
      profit: 2,
      entryTimestamp: 123,
      strategy: 'TRENDLINE',
    };
    const trimmedRow = {
      TF15M_Price1hPcnt_1: 0.11,
      TF15M_Price1hPcnt_5: 0.22,
      label: 1,
      profit: 2,
      entryTimestamp: 123,
      strategy: 'TRENDLINE',
    };
    mockBuildMlTrainingRow.mockReturnValue(fullRow);
    mockTrimMlTrainingRowWindows.mockReturnValue(trimmedRow);

    const signal = {
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
    } as any;
    const config = {
      strategyName: 'TrendLine',
      symbol: 'ETHUSDT',
      ML_THRESHOLD: 0.4,
    } as any;

    const response = await fetchMlThreshold(signal, config);

    expect(response).toEqual({
      probability: 0.7,
      threshold: 0.4,
      passed: true,
    });
    expect(mockBuildMlTrainingRow).toHaveBeenCalledTimes(1);
    expect(mockTrimMlTrainingRowWindows).toHaveBeenCalledWith(fullRow, 5);
    expect(mockPredict).toHaveBeenCalledTimes(1);

    const predictRequest = mockPredict.mock.calls[0][0];
    expect(predictRequest.strategy).toBe('TrendLine');
    expect(predictRequest.threshold).toBe(0.4);
    expect(predictRequest.features).toEqual({
      TF15M_Price1hPcnt_1: 0.11,
      TF15M_Price1hPcnt_5: 0.22,
    });
    expect(predictRequest.features.TF15M_Price1hPcnt_49).toBeUndefined();
    expect(predictRequest.features.entryTimestamp).toBeUndefined();
    expect(predictRequest.features.label).toBeUndefined();
    expect(predictRequest.features.profit).toBeUndefined();
  });
});
