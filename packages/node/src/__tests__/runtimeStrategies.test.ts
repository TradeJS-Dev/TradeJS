import type { RuntimeDeployment, RuntimeStrategyRelease } from '@tradejs/types';

const release: RuntimeStrategyRelease = {
  schema: 'tradejs-runtime-strategy-release/v2',
  strategyName: 'DoubleTap',
  releaseVersion: 2,
  config: {
    INTERVAL: '15',
    UNIVERSE: 'crypto',
    POLICY_PROFILE_ID: 'crypto',
    MAX_LOSS_VALUE: 1,
  },
  strategyPackage: '@tradejs/strategy-double-tap',
  strategyPackageVersion: '3.2.0',
  runtimePackageVersion: '3.1.0',
  createdAt: 1,
  createdBy: 'root',
  contentSha256: 'a'.repeat(64),
};

const deployment: RuntimeDeployment = {
  id: 'doubletap-forward',
  label: 'DoubleTap forward',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-main',
  universe: 'tradfi',
  interval: '5',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      releaseVersion: 2,
      controlState: 'entries_paused',
    },
  ],
};

describe('shared versioned runtime strategy resolver', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('node:fs/promises', () => ({
      readFile: jest.fn(async (filePath: string) => {
        if (filePath.endsWith('runtime-package-manifest.json')) {
          return JSON.stringify({
            packages: {
              '@tradejs/strategy-double-tap': '3.2.0',
              '@tradejs/node': '3.1.0',
            },
          });
        }
        throw new Error('not found');
      }),
    }));
    jest.doMock('@tradejs/infra/runtimeStrategyReleases', () => ({
      getRuntimeStrategyRelease: jest.fn(async () => release),
    }));
    jest.doMock('@tradejs/infra/runtimeStrategyConfigs', () => ({
      loadRuntimeStrategyConfigs: jest.fn(async () => []),
    }));
    jest.doMock('@tradejs/infra/tradingAccounts', () => ({
      resolveTradingAccount: jest.fn(async () => ({ id: 'bybit-main' })),
    }));
    jest.doMock('@tradejs/infra/redis', () => ({
      getData: jest.fn(async () => ({})),
      redisKeys: { strategyResults: jest.fn() },
    }));
    jest.doMock('../strategy/manifests', () => ({
      getStrategyCreator: jest.fn(async () => jest.fn()),
      getStrategyPluginSource: jest.fn(
        async () => '@tradejs/strategy-double-tap',
      ),
    }));
  });

  it('uses only the immutable release config and ignores legacy deployment scope', async () => {
    const { loadResolvedRuntimeStrategies } = await import(
      '../runtimeStrategies'
    );
    const [resolved] = await loadResolvedRuntimeStrategies({
      userName: 'root',
      projectRoot: '/project',
      deployment,
    });

    expect(resolved).toEqual(
      expect.objectContaining({
        strategyName: 'DoubleTap',
        releaseVersion: 2,
        controlState: 'entries_paused',
        interval: '15',
        universe: 'crypto',
        accountId: 'bybit-main',
        strategyConfig: release.config,
        sourceStrategyConfig: release.config,
        strategyResults: {},
      }),
    );
    expect(resolved).not.toHaveProperty('configId');
    expect(resolved?.strategyConfig).not.toHaveProperty('ACCOUNT_ID');
  });

  it('rejects embedded deployment config for a versioned reference', async () => {
    const { loadResolvedRuntimeStrategies } = await import(
      '../runtimeStrategies'
    );
    await expect(
      loadResolvedRuntimeStrategies({
        userName: 'root',
        projectRoot: '/project',
        deployment: {
          ...deployment,
          strategies: [
            { ...deployment.strategies[0], config: { INTERVAL: '5' } },
          ],
        },
      }),
    ).rejects.toThrow('must not embed config');
  });
});
