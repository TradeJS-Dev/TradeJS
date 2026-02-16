import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { buildMlTrainingRow } from '@utils/mlTrainingTransform';
import { logger } from '@utils/logger';
import { Signal } from '@types';
import { buildMlPayload, MlTestConfig } from '@utils/mlPayload';

type MlPredictResponse = {
  probability: number;
  threshold: number;
  passed: boolean;
};

const clientCache = new Map<string, any>();

const getClient = (address: string) => {
  const cached = clientCache.get(address);
  if (cached) return cached;

  const protoPath = path.resolve(__dirname, '../../proto/ml_infer.proto');
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDefinition) as any;
  const client = new proto.ml_infer.MlInfer(
    address,
    grpc.credentials.createInsecure(),
  );
  clientCache.set(address, client);
  return client;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const fetchMlThreshold = async (
  signal: Signal,
  testConfig: MlTestConfig,
): Promise<MlPredictResponse | null> => {
  try {
    const strategyName = testConfig.strategyName || signal.strategy;
    const threshold =
      toFiniteNumber(testConfig.threshold) ??
      toFiniteNumber(testConfig.ML_THRESHOLD) ??
      0;

    const row = buildMlTrainingRow(
      buildMlPayload({
        signal,
        context: {
          strategyConfig: testConfig.strategyConfig,
          strategyName,
          symbol: testConfig.symbol || signal.symbol,
        },
      }),
      null,
    );

    const features: Record<string, number> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === 'label' || key === 'profit' || key === 'entryTimestamp')
        continue;
      const num = toFiniteNumber(value);
      if (num != null) features[key] = num;
    }

    const address =
      testConfig.grpcAddress ||
      process.env.ML_GRPC_ADDRESS ||
      'localhost:50051';
    const client = getClient(address);

    return await new Promise((resolve, reject) => {
      client.Predict(
        {
          strategy: strategyName,
          features,
          threshold,
        },
        (err: Error | null, response: MlPredictResponse) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(response);
        },
      );
    });
  } catch (err) {
    logger.error('ml grpc error: %s', err);
    return null;
  }
};
