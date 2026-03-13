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

import { buildMlFeatures, fetchMlThreshold } from '@tradejs/infra';

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

  test('buildMlFeatures removes service fields and keeps numeric features', () => {
    const features = buildMlFeatures({
      TF15M_ALT_Price1hPcnt_1: 0.11,
      TF15M_ALT_Price1hPcnt_5: 0.22,
      label: 1,
      profit: 2,
      entryTimestamp: 123,
      strategy: 'TRENDLINE',
      invalid: 'x',
    });

    expect(features).toEqual({
      TF15M_ALT_Price1hPcnt_1: 0.11,
      TF15M_ALT_Price1hPcnt_5: 0.22,
    });
  });

  test('fetchMlThreshold sends predict request to grpc', async () => {
    const response = await fetchMlThreshold({
      strategy: 'TrendLine',
      threshold: 0.4,
      features: {
        TF15M_ALT_Price1hPcnt_1: 0.11,
      },
      grpcAddress: 'localhost:50051',
    });

    expect(response).toEqual({
      probability: 0.7,
      threshold: 0.4,
      passed: true,
    });
    expect(mockPredict).toHaveBeenCalledTimes(1);

    const predictRequest = mockPredict.mock.calls[0][0];
    expect(predictRequest).toEqual({
      strategy: 'TrendLine',
      threshold: 0.4,
      features: {
        TF15M_ALT_Price1hPcnt_1: 0.11,
      },
    });
  });
});
