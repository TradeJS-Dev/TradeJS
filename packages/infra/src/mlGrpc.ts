import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import { logger } from './logger';

export type MlPredictResponse = {
  probability: number;
  threshold: number;
  passed: boolean;
};

export type MlPredictParams = {
  strategy: string;
  features: Record<string, number>;
  threshold: number;
  grpcAddress?: string;
  protoPath?: string;
  projectRoot?: string;
};

const clientCache = new Map<string, any>();

const resolveProtoPath = (projectRoot?: string, protoPath?: string): string => {
  if (protoPath && fs.existsSync(protoPath)) {
    return protoPath;
  }

  const explicitRoot = String(projectRoot || '').trim();
  const root = explicitRoot
    ? path.resolve(explicitRoot)
    : String(process.env.PROJECT_CWD || '').trim()
      ? path.resolve(String(process.env.PROJECT_CWD || '').trim())
      : process.cwd();
  const candidates = [
    path.resolve(__dirname, '../proto/ml_infer.proto'),
    path.resolve(__dirname, '../../proto/ml_infer.proto'),
    path.resolve(root, 'proto/ml_infer.proto'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1];
};

const getClient = (
  address: string,
  projectRoot?: string,
  protoPath?: string,
) => {
  const resolvedProtoPath = resolveProtoPath(projectRoot, protoPath);
  const cacheKey = `${address}::${resolvedProtoPath}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const packageDefinition = protoLoader.loadSync(resolvedProtoPath, {
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
  clientCache.set(cacheKey, client);
  return client;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const buildMlFeatures = (
  row: Record<string, unknown>,
): Record<string, number> => {
  const features: Record<string, number> = {};
  for (const [key, value] of Object.entries(row)) {
    if (
      key === 'label' ||
      key === 'profit' ||
      key === 'entryTimestamp' ||
      key === 'strategy'
    ) {
      continue;
    }
    const num = toFiniteNumber(value);
    if (num != null) {
      features[key] = num;
    }
  }
  return features;
};

export const fetchMlThreshold = async ({
  strategy,
  features,
  threshold,
  grpcAddress,
  protoPath,
  projectRoot,
}: MlPredictParams): Promise<MlPredictResponse | null> => {
  try {
    const address =
      grpcAddress || process.env.ML_GRPC_ADDRESS || 'localhost:50051';
    const client = getClient(address, projectRoot, protoPath);

    return await new Promise((resolve, reject) => {
      client.Predict(
        {
          strategy,
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
