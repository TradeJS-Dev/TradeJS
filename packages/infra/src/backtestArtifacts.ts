import fs from 'fs/promises';
import path from 'path';
import type { OrderLogData, PositionLogData } from '@tradejs/types';

export interface BacktestArtifactRef {
  kind: 'file';
  version: 1;
  path: string;
}

const BACKTEST_ARTIFACTS_DIR = path.join('data', 'backtests');

const resolveProjectRoot = (projectRoot?: string): string => {
  const explicit = String(projectRoot || '').trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const fromEnv = String(process.env.PROJECT_CWD || '').trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  return process.cwd();
};

const encodeSegment = (value: string) => encodeURIComponent(String(value));

const toProjectRelativePath = (
  projectRoot: string,
  absolutePath: string,
): string => path.relative(projectRoot, absolutePath);

const resolveArtifactPath = (
  relativePath: string,
  projectRoot?: string,
): string => {
  const root = resolveProjectRoot(projectRoot);
  return path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(root, relativePath);
};

const isEnoentError = (error: unknown) =>
  (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

const createRef = (
  absolutePath: string,
  projectRoot?: string,
): BacktestArtifactRef => ({
  kind: 'file',
  version: 1,
  path: toProjectRelativePath(resolveProjectRoot(projectRoot), absolutePath),
});

const isBacktestArtifactRef = (value: unknown): value is BacktestArtifactRef =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (value as BacktestArtifactRef).kind === 'file' &&
      (value as BacktestArtifactRef).version === 1 &&
      typeof (value as BacktestArtifactRef).path === 'string',
  );

const getCachedArtifactPath = (
  userName: string,
  orderLogId: string,
  artifactName: 'orders' | 'positions',
  projectRoot?: string,
) =>
  path.join(
    resolveProjectRoot(projectRoot),
    BACKTEST_ARTIFACTS_DIR,
    'cache',
    encodeSegment(userName),
    artifactName,
    `${encodeSegment(orderLogId)}.json`,
  );

const getPersistedOrderLogPath = (
  userName: string,
  strategyName: string,
  testName: string,
  projectRoot?: string,
) =>
  path.join(
    resolveProjectRoot(projectRoot),
    BACKTEST_ARTIFACTS_DIR,
    'tests',
    encodeSegment(userName),
    encodeSegment(strategyName),
    `${encodeSegment(testName)}.json`,
  );

const readJsonFile = async <T>(
  absolutePath: string,
  fallback: T,
): Promise<T> => {
  try {
    const raw = await fs.readFile(absolutePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isEnoentError(error)) {
      return fallback;
    }
    throw error;
  }
};

const writeJsonFile = async (
  absolutePath: string,
  value: unknown,
): Promise<void> => {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(value), 'utf8');
};

const removeFileIfExists = async (absolutePath: string): Promise<boolean> => {
  try {
    await fs.rm(absolutePath, { force: true });
    return true;
  } catch (error) {
    if (isEnoentError(error)) {
      return false;
    }
    throw error;
  }
};

export const writeCachedBacktestArtifacts = async ({
  orderLog,
  orderLogId,
  positionLog,
  projectRoot,
  userName,
}: {
  orderLog: OrderLogData;
  orderLogId: string;
  positionLog: PositionLogData;
  projectRoot?: string;
  userName: string;
}) => {
  const orderPath = getCachedArtifactPath(
    userName,
    orderLogId,
    'orders',
    projectRoot,
  );
  const positionPath = getCachedArtifactPath(
    userName,
    orderLogId,
    'positions',
    projectRoot,
  );

  await Promise.all([
    writeJsonFile(orderPath, orderLog),
    writeJsonFile(positionPath, positionLog),
  ]);

  return {
    orderLog: createRef(orderPath, projectRoot),
    positionLog: createRef(positionPath, projectRoot),
  };
};

export const readCachedBacktestArtifacts = async ({
  orderLogId,
  projectRoot,
  userName,
}: {
  orderLogId: string;
  projectRoot?: string;
  userName: string;
}): Promise<{
  orderLog: OrderLogData | null;
  positionLog: PositionLogData | null;
}> => {
  const orderPath = getCachedArtifactPath(
    userName,
    orderLogId,
    'orders',
    projectRoot,
  );
  const positionPath = getCachedArtifactPath(
    userName,
    orderLogId,
    'positions',
    projectRoot,
  );

  const [orderLog, positionLog] = await Promise.all([
    readJsonFile<OrderLogData | null>(orderPath, null),
    readJsonFile<PositionLogData | null>(positionPath, null),
  ]);

  return { orderLog, positionLog };
};

export const deleteCachedBacktestArtifacts = async ({
  orderLogId,
  projectRoot,
  userName,
}: {
  orderLogId: string;
  projectRoot?: string;
  userName: string;
}) => {
  const orderPath = getCachedArtifactPath(
    userName,
    orderLogId,
    'orders',
    projectRoot,
  );
  const positionPath = getCachedArtifactPath(
    userName,
    orderLogId,
    'positions',
    projectRoot,
  );

  const [removedOrderLog, removedPositionLog] = await Promise.all([
    removeFileIfExists(orderPath),
    removeFileIfExists(positionPath),
  ]);

  return removedOrderLog || removedPositionLog;
};

export const writePersistedBacktestOrderLog = async ({
  orderLog,
  projectRoot,
  strategyName,
  testName,
  userName,
}: {
  orderLog: OrderLogData;
  projectRoot?: string;
  strategyName: string;
  testName: string;
  userName: string;
}): Promise<BacktestArtifactRef> => {
  const absolutePath = getPersistedOrderLogPath(
    userName,
    strategyName,
    testName,
    projectRoot,
  );
  await writeJsonFile(absolutePath, orderLog);
  return createRef(absolutePath, projectRoot);
};

export const readPersistedBacktestOrderLog = async ({
  projectRoot,
  ref,
  strategyName,
  testName,
  userName,
}: {
  projectRoot?: string;
  ref?: BacktestArtifactRef | null;
  strategyName: string;
  testName: string;
  userName: string;
}): Promise<OrderLogData | null> => {
  const absolutePath = ref
    ? resolveArtifactPath(ref.path, projectRoot)
    : getPersistedOrderLogPath(userName, strategyName, testName, projectRoot);

  return readJsonFile<OrderLogData | null>(absolutePath, null);
};

export const deletePersistedBacktestOrderLog = async ({
  projectRoot,
  ref,
  strategyName,
  testName,
  userName,
}: {
  projectRoot?: string;
  ref?: BacktestArtifactRef | null;
  strategyName: string;
  testName: string;
  userName: string;
}) => {
  const absolutePath = ref
    ? resolveArtifactPath(ref.path, projectRoot)
    : getPersistedOrderLogPath(userName, strategyName, testName, projectRoot);

  return removeFileIfExists(absolutePath);
};

export const parseBacktestArtifactRef = (
  value: unknown,
): BacktestArtifactRef | null => {
  if (isBacktestArtifactRef(value)) {
    return value;
  }

  return null;
};

export const getBacktestArtifactsRootDir = (projectRoot?: string) =>
  path.join(resolveProjectRoot(projectRoot), BACKTEST_ARTIFACTS_DIR);

export const getBacktestCacheArtifactsDirForUser = (
  userName: string,
  projectRoot?: string,
) =>
  path.join(
    getBacktestArtifactsRootDir(projectRoot),
    'cache',
    encodeSegment(userName),
  );

export const getPersistedBacktestArtifactsDirForUser = (
  userName: string,
  projectRoot?: string,
) =>
  path.join(
    getBacktestArtifactsRootDir(projectRoot),
    'tests',
    encodeSegment(userName),
  );
