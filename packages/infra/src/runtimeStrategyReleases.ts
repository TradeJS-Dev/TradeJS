import { createHash, randomUUID } from 'node:crypto';
import {
  RUNTIME_STRATEGY_RELEASE_SCHEMA,
  type RuntimeStrategyControlEvent,
  type RuntimeStrategyControlState,
  type RuntimeStrategyRelease,
  type StrategyConfig,
} from '@tradejs/types';
import {
  getData,
  getKeys,
  incrementKey,
  redisKeys,
  setData,
  setDataIfAbsent,
} from './redis';

const SHA256_RE = /^[a-f0-9]{64}$/;
const FORBIDDEN_RELEASE_CONFIG_KEYS = new Set([
  'ACCOUNT_ID',
  'AI_REPLAY_ANALYSES',
  'DEPLOYMENT_ID',
  'ENABLE',
  'ENV',
  'MAKE_ORDERS',
  'RECORD_RUNTIME_TRADES',
  'configId',
]);
const SECRET_CONFIG_KEY_RE =
  /(?:^|_)(?:API_KEY|API_SECRET|TOKEN|PASSWORD|PRIVATE_KEY)$/i;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const canonicalJson = (value: unknown): string => {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    const record = asRecord(current);
    if (!record) return current;
    return Object.fromEntries(
      Object.entries(record)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  };
  return JSON.stringify(normalize(value));
};

const releaseContentSha256 = (
  release: Omit<RuntimeStrategyRelease, 'contentSha256'>,
) => createHash('sha256').update(canonicalJson(release)).digest('hex');

const assertStrategyName = (strategyName: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(strategyName)) {
    throw new Error(`Invalid strategy name: ${strategyName}`);
  }
};

const assertPackageIdentity = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required for a runtime strategy release`);
  }
};

export const assertRuntimeStrategyReleaseConfig = (config: StrategyConfig) => {
  const record = asRecord(config);
  if (!record) throw new Error('Strategy release config must be an object');
  for (const key of FORBIDDEN_RELEASE_CONFIG_KEYS) {
    if (record[key] !== undefined) {
      throw new Error(`${key} is a deployment binding, not release config`);
    }
  }
  const inspect = (value: unknown, parentPath = ''): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) =>
        inspect(entry, `${parentPath}[${index}]`),
      );
      return;
    }
    const current = asRecord(value);
    if (!current) return;
    for (const [key, entry] of Object.entries(current)) {
      const keyPath = parentPath ? `${parentPath}.${key}` : key;
      if (SECRET_CONFIG_KEY_RE.test(key)) {
        throw new Error(`${keyPath} is secret material, not release config`);
      }
      inspect(entry, keyPath);
    }
  };
  inspect(record);
  if (typeof record.INTERVAL !== 'string' || !record.INTERVAL.trim()) {
    throw new Error('Published strategy config must define INTERVAL');
  }
  if (record.UNIVERSE !== 'crypto' && record.UNIVERSE !== 'tradfi') {
    throw new Error('Published strategy config must define a valid UNIVERSE');
  }
};

const isRelease = (value: unknown): value is RuntimeStrategyRelease => {
  const release = asRecord(value);
  return Boolean(
    release?.schema === RUNTIME_STRATEGY_RELEASE_SCHEMA &&
      typeof release.strategyName === 'string' &&
      Number.isSafeInteger(release.releaseVersion) &&
      Number(release.releaseVersion) > 0 &&
      asRecord(release.config) &&
      typeof release.strategyPackage === 'string' &&
      Boolean(release.strategyPackage.trim()) &&
      typeof release.strategyPackageVersion === 'string' &&
      Boolean(release.strategyPackageVersion.trim()) &&
      typeof release.runtimePackageVersion === 'string' &&
      Boolean(release.runtimePackageVersion.trim()) &&
      typeof release.createdAt === 'number' &&
      typeof release.createdBy === 'string' &&
      typeof release.contentSha256 === 'string' &&
      SHA256_RE.test(release.contentSha256),
  );
};

export const verifyRuntimeStrategyRelease = (
  value: unknown,
): RuntimeStrategyRelease => {
  if (!isRelease(value)) throw new Error('Invalid runtime strategy release');
  const { contentSha256, ...content } = value;
  if (releaseContentSha256(content) !== contentSha256) {
    throw new Error(
      `${value.strategyName} v${value.releaseVersion} content checksum mismatch`,
    );
  }
  assertRuntimeStrategyReleaseConfig(value.config);
  return value;
};

export const getRuntimeStrategyRelease = async (
  userName: string,
  strategyName: string,
  releaseVersion: number,
): Promise<RuntimeStrategyRelease | null> => {
  const value = await getData(
    redisKeys.runtimeStrategyRelease(userName, strategyName, releaseVersion),
    null,
  );
  return value == null ? null : verifyRuntimeStrategyRelease(value);
};

export const listRuntimeStrategyReleases = async (
  userName: string,
  strategyName: string,
): Promise<RuntimeStrategyRelease[]> => {
  const keys = await getKeys(
    redisKeys.runtimeStrategyReleases(userName, strategyName),
  );
  const releases = await Promise.all(
    keys.map(async (key) => {
      const value = await getData(key, null);
      return value == null ? null : verifyRuntimeStrategyRelease(value);
    }),
  );
  return releases
    .filter((release): release is RuntimeStrategyRelease => release != null)
    .sort((left, right) => right.releaseVersion - left.releaseVersion);
};

export const publishRuntimeStrategyRelease = async ({
  userName,
  strategyName,
  config,
  strategyPackage,
  strategyPackageVersion,
  runtimePackageVersion,
  createdBy,
}: {
  userName: string;
  strategyName: string;
  config: StrategyConfig;
  strategyPackage: string;
  strategyPackageVersion: string;
  runtimePackageVersion: string;
  createdBy: string;
}): Promise<RuntimeStrategyRelease> => {
  assertStrategyName(strategyName);
  assertRuntimeStrategyReleaseConfig(config);
  assertPackageIdentity(strategyPackage, 'strategyPackage');
  assertPackageIdentity(strategyPackageVersion, 'strategyPackageVersion');
  assertPackageIdentity(runtimePackageVersion, 'runtimePackageVersion');
  const releaseVersion = await incrementKey(
    redisKeys.runtimeStrategyReleaseSequence(userName, strategyName),
  );
  const content: Omit<RuntimeStrategyRelease, 'contentSha256'> = {
    schema: RUNTIME_STRATEGY_RELEASE_SCHEMA,
    strategyName,
    releaseVersion,
    config,
    strategyPackage,
    strategyPackageVersion,
    runtimePackageVersion,
    createdAt: Date.now(),
    createdBy,
  };
  const release: RuntimeStrategyRelease = {
    ...content,
    contentSha256: releaseContentSha256(content),
  };
  const stored = await setDataIfAbsent(
    redisKeys.runtimeStrategyRelease(userName, strategyName, releaseVersion),
    release,
  );
  if (!stored) {
    throw new Error(`Refused to overwrite ${strategyName} v${releaseVersion}`);
  }
  return release;
};

export const recordRuntimeStrategyControlEvent = async ({
  userName,
  deploymentId,
  strategyName,
  releaseVersion,
  previousState,
  nextState,
  createdBy,
}: {
  userName: string;
  deploymentId: string;
  strategyName: string;
  releaseVersion: number;
  previousState: RuntimeStrategyControlState;
  nextState: RuntimeStrategyControlState;
  createdBy: string;
}): Promise<RuntimeStrategyControlEvent> => {
  const action = nextState === 'entries_paused' ? 'pause_entries' : 'resume';
  const createdAt = Date.now();
  const event: RuntimeStrategyControlEvent = {
    eventId: `${createdAt}-${randomUUID()}`,
    deploymentId,
    strategyName,
    releaseVersion,
    action,
    previousState,
    nextState,
    createdAt,
    createdBy,
  };
  await setData(
    redisKeys.runtimeStrategyControlEvent(userName, event.eventId),
    event,
    { expire: 0 },
  );
  return event;
};
