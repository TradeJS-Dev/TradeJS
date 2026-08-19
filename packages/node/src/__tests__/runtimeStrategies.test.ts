const runtimeConfig = {
  deployments: {
    production: {
      label: 'Production',
      connectorName: 'bybit',
      accountId: 'bybit-main',
      strategies: {
        DoubleTap: {
          version: 4,
          enabled: true,
          config: {
            INTERVAL: '15',
            UNIVERSE: 'crypto',
            POLICY_PROFILE_ID: 'crypto',
            MAX_LOSS_VALUE: 1,
          },
        },
      },
    },
  },
};

describe('Git-owned runtime strategy resolver', () => {
  const mockLoadTradejsConfig = jest.fn(
    async (): Promise<any> => ({
      runtime: runtimeConfig,
    }),
  );
  const mockGetRuntimeControls = jest.fn(
    async (): Promise<any> => ({
      schema: 'tradejs-runtime-controls/v1',
      deployments: {},
    }),
  );

  beforeEach(() => {
    jest.resetModules();
    mockLoadTradejsConfig.mockClear();
    mockGetRuntimeControls.mockClear();
    jest.doMock('node:fs/promises', () => ({
      readFile: jest.fn(async (filePath: string) => {
        if (filePath.endsWith('runtime-package-manifest.json')) {
          return JSON.stringify({
            packages: {
              '@tradejs/strategy-double-tap': '3.2.0',
              '@tradejs/node': '3.2.0',
            },
          });
        }
        throw new Error('not found');
      }),
    }));
    jest.doMock('../tradejsConfig', () => ({
      loadTradejsConfig: mockLoadTradejsConfig,
    }));
    jest.doMock('@tradejs/infra/runtimeControls', () => ({
      getRuntimeControls: mockGetRuntimeControls,
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

  it('loads deployments from tradejs.config and applies an optional pause override', async () => {
    mockGetRuntimeControls.mockResolvedValueOnce({
      schema: 'tradejs-runtime-controls/v1',
      deployments: {
        production: {
          DoubleTap: {
            entriesPaused: true,
            updatedAt: '2026-08-19T10:00:00.000Z',
            updatedBy: 'root',
          },
        },
      },
    });
    const { listRuntimeDeployments } = await import('../runtimeStrategies');

    await expect(
      listRuntimeDeployments({ userName: 'root', projectRoot: '/project' }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'production',
        provider: 'bybit',
        strategies: [
          {
            strategyName: 'DoubleTap',
            version: 4,
            enabled: true,
            controlState: 'entries_paused',
          },
        ],
      }),
    ]);
  });

  it('uses only the strategy config declared in tradejs.config', async () => {
    const { loadResolvedRuntimeStrategies } = await import(
      '../runtimeStrategies'
    );
    const [resolved] = await loadResolvedRuntimeStrategies({
      userName: 'root',
      projectRoot: '/project',
      deploymentId: 'production',
    });

    expect(resolved).toEqual(
      expect.objectContaining({
        strategyName: 'DoubleTap',
        version: 4,
        controlState: 'active',
        interval: '15',
        universe: 'crypto',
        accountId: 'bybit-main',
        strategyPackage: '@tradejs/strategy-double-tap',
        strategyPackageVersion: '3.2.0',
        runtimePackageVersion: '3.2.0',
        strategyConfig:
          runtimeConfig.deployments.production.strategies.DoubleTap.config,
        sourceStrategyConfig:
          runtimeConfig.deployments.production.strategies.DoubleTap.config,
      }),
    );
    expect(resolved).not.toHaveProperty('releaseVersion');
  });

  it('treats Git disabled as entries paused even without a controls key', async () => {
    mockLoadTradejsConfig.mockResolvedValueOnce({
      runtime: {
        deployments: {
          production: {
            ...runtimeConfig.deployments.production,
            strategies: {
              DoubleTap: {
                ...runtimeConfig.deployments.production.strategies.DoubleTap,
                enabled: false,
              },
            },
          },
        },
      },
    });
    const { loadResolvedRuntimeStrategies } = await import(
      '../runtimeStrategies'
    );

    await expect(
      loadResolvedRuntimeStrategies({
        userName: 'root',
        projectRoot: '/project',
        deploymentId: 'production',
      }),
    ).resolves.toEqual([
      expect.objectContaining({ controlState: 'entries_paused' }),
    ]);
  });

  it('rejects a missing runtime declaration without a legacy fallback', async () => {
    mockLoadTradejsConfig.mockResolvedValueOnce({});
    const { listRuntimeDeployments } = await import('../runtimeStrategies');

    await expect(
      listRuntimeDeployments({ userName: 'root', projectRoot: '/project' }),
    ).rejects.toThrow('Runtime declaration is required');
  });

  it('rejects release-era fields in a strategy declaration', async () => {
    mockLoadTradejsConfig.mockResolvedValueOnce({
      runtime: {
        deployments: {
          production: {
            ...runtimeConfig.deployments.production,
            strategies: {
              DoubleTap: {
                ...runtimeConfig.deployments.production.strategies.DoubleTap,
                releaseVersion: 4,
              },
            },
          },
        },
      },
    });
    const { listRuntimeDeployments } = await import('../runtimeStrategies');

    await expect(
      listRuntimeDeployments({ userName: 'root', projectRoot: '/project' }),
    ).rejects.toThrow('Invalid runtime strategy declaration');
  });

  it('identifies a project-local strategy by the exact project package', async () => {
    jest.doMock('node:fs/promises', () => ({
      readFile: jest.fn(async (filePath: string) => {
        if (filePath.endsWith('runtime-package-manifest.json')) {
          return JSON.stringify({
            packages: {
              '@tradejs/example-sandbox': '1.0.0',
              '@tradejs/node': '3.2.0',
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
      runtimePackageVersion: '3.2.0',
    });
  });

  it('rejects a deployment whose canonical trading account is missing', async () => {
    jest.doMock('@tradejs/infra/tradingAccounts', () => ({
      resolveTradingAccount: jest.fn(async () => null),
    }));
    const { loadResolvedRuntimeStrategies } = await import(
      '../runtimeStrategies'
    );

    await expect(
      loadResolvedRuntimeStrategies({
        userName: 'root',
        projectRoot: '/project',
        deploymentId: 'production',
      }),
    ).rejects.toThrow('Trading account not found: bybit-main');
  });
});
