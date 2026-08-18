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
    jest.doMock('@tradejs/infra/tradingAccounts', () => ({
      resolveTradingAccount: jest.fn(async () => ({ id: 'bybit-main' })),
    }));
    jest.doMock('../strategy/manifests', () => ({
      getStrategyCreator: jest.fn(async () => jest.fn()),
      getStrategyPluginSource: jest.fn(
        async () => '@tradejs/strategy-double-tap',
      ),
    }));
  });

  it('uses only the immutable release config', async () => {
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
      }),
    );
    expect(resolved).not.toHaveProperty('configId');
    expect(resolved).not.toHaveProperty('strategyResults');
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
            {
              ...deployment.strategies[0],
              config: { INTERVAL: '5' },
            } as any,
          ],
        },
      }),
    ).rejects.toThrow('has invalid fields');
  });

  it('requires an explicit canonical deployment', async () => {
    const { loadResolvedRuntimeStrategies } = await import(
      '../runtimeStrategies'
    );

    await expect(
      loadResolvedRuntimeStrategies({
        userName: 'root',
        projectRoot: '/project',
      }),
    ).rejects.toThrow('Runtime deployment is required');
  });

  it('rejects a release pointer without an explicit control state', async () => {
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
            {
              strategyName: 'DoubleTap',
              releaseVersion: 2,
            } as any,
          ],
        },
      }),
    ).rejects.toThrow('has no controlState');
  });

  it('identifies a project-local strategy by the exact project package', async () => {
    jest.doMock('node:fs/promises', () => ({
      readFile: jest.fn(async (filePath: string) => {
        if (filePath.endsWith('runtime-package-manifest.json')) {
          return JSON.stringify({
            packages: {
              '@tradejs/example-sandbox': '1.0.0',
              '@tradejs/node': '3.1.4',
            },
          });
        }
        if (filePath === '/project/package.json') {
          return JSON.stringify({
            name: '@tradejs/example-sandbox',
            version: '1.0.0',
          });
        }
        throw new Error('not found');
      }),
    }));
    jest.doMock('../strategy/manifests', () => ({
      getStrategyCreator: jest.fn(async () => jest.fn()),
      getStrategyPluginSource: jest.fn(
        async () => './src/plugins/sandboxStrategy.plugin.ts',
      ),
    }));
    const { getRuntimeStrategyPackageMetadata } = await import(
      '../runtimeStrategies'
    );

    await expect(
      getRuntimeStrategyPackageMetadata({
        strategyName: 'SandboxDeterministicSignal',
        projectRoot: '/project',
      }),
    ).resolves.toEqual({
      strategyPackage: '@tradejs/example-sandbox',
      strategyPackageVersion: '1.0.0',
      runtimePackageVersion: '3.1.4',
    });
  });
});
