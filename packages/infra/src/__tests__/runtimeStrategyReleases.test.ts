const mockGetData = jest.fn();
const mockGetKeys = jest.fn();
const mockIncrementKey = jest.fn();
const mockSetData = jest.fn();
const mockSetDataIfAbsent = jest.fn();

jest.mock('../redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  getKeys: (...args: unknown[]) => mockGetKeys(...args),
  incrementKey: (...args: unknown[]) => mockIncrementKey(...args),
  setData: (...args: unknown[]) => mockSetData(...args),
  setDataIfAbsent: (...args: unknown[]) => mockSetDataIfAbsent(...args),
  redisKeys: {
    runtimeStrategyReleaseSequence: (user: string, strategy: string) =>
      `users:${user}:strategies:${strategy}:release-seq`,
    runtimeStrategyRelease: (user: string, strategy: string, version: number) =>
      `users:${user}:strategies:${strategy}:releases:${version}`,
    runtimeStrategyReleases: (user: string, strategy: string) =>
      `users:${user}:strategies:${strategy}:releases:`,
    runtimeStrategyDraft: (user: string, strategy: string) =>
      `users:${user}:strategies:${strategy}:draft`,
    runtimeStrategyControlEvent: (user: string, event: string) =>
      `users:${user}:runtime:strategy-control-events:${event}`,
  },
}));

import {
  publishRuntimeStrategyRelease,
  verifyRuntimeStrategyRelease,
} from '../runtimeStrategyReleases';

describe('runtime strategy releases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIncrementKey.mockResolvedValue(3);
    mockSetDataIfAbsent.mockResolvedValue(true);
  });

  it('publishes a per-strategy immutable version with an integrity checksum', async () => {
    const release = await publishRuntimeStrategyRelease({
      userName: 'root',
      strategyName: 'DoubleTap',
      config: { INTERVAL: '15', UNIVERSE: 'crypto', MAX_LOSS_VALUE: 1 },
      strategyPackage: '@tradejs/strategy-double-tap',
      strategyPackageVersion: '3.2.0',
      runtimePackageVersion: '3.1.0',
      createdBy: 'root',
    });

    expect(release.releaseVersion).toBe(3);
    expect(release.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(mockSetDataIfAbsent).toHaveBeenCalledWith(
      'users:root:strategies:DoubleTap:releases:3',
      release,
    );
    expect(verifyRuntimeStrategyRelease(release)).toEqual(release);
  });

  it('refuses runtime/deployment bindings in release config', async () => {
    await expect(
      publishRuntimeStrategyRelease({
        userName: 'root',
        strategyName: 'DoubleTap',
        config: {
          INTERVAL: '15',
          UNIVERSE: 'crypto',
          ACCOUNT_ID: 'prod',
        },
        createdBy: 'root',
      }),
    ).rejects.toThrow('ACCOUNT_ID is a deployment binding');
  });

  it('refuses secret material anywhere in release config', async () => {
    await expect(
      publishRuntimeStrategyRelease({
        userName: 'root',
        strategyName: 'DoubleTap',
        config: {
          INTERVAL: '15',
          UNIVERSE: 'crypto',
          PROVIDER: { API_SECRET: 'must-not-be-published' },
        },
        createdBy: 'root',
      }),
    ).rejects.toThrow('PROVIDER.API_SECRET is secret material');
  });

  it('detects mutation of a published record', async () => {
    const release = await publishRuntimeStrategyRelease({
      userName: 'root',
      strategyName: 'DoubleTap',
      config: { INTERVAL: '15', UNIVERSE: 'crypto' },
      createdBy: 'root',
    });
    expect(() =>
      verifyRuntimeStrategyRelease({
        ...release,
        config: { ...release.config, INTERVAL: '5' },
      }),
    ).toThrow('content checksum mismatch');
  });
});
