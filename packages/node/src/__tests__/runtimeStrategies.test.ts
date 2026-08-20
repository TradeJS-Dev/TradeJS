const runtimeConfig = {
  deployments: {
    production: {
      label: 'Production',
      connectorName: 'bybit',
      accountId: 'bybit-main',
      strategies: {
        DoubleTap: {
          enabled: true,
          selection: { tickers: ['BTCUSDT', 'ETHUSDT'] },
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
            schema: 'tradejs-runtime-package-manifest/v1',
            projectSha: 'a'.repeat(40),
            packages: {
              '@tradejs/strategy-double-tap': '3.2.0',
              '@tradejs/node': '3.2.0',
            },
          });
        }
        if (
          filePath.endsWith(
            'node_modules/@tradejs/strategy-double-tap/package.json',
          )
        ) {
          return JSON.stringify({
            name: '@tradejs/strategy-double-tap',
            version: '3.2.0',
          });
        }
        if (filePath.endsWith('node_modules/@tradejs/node/package.json')) {
          return JSON.stringify({ name: '@tradejs/node', version: '3.2.0' });
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
    jest.doMock('../strategy', () => ({
      getStrategyEntry: jest.fn(async () => ({
        parseConfig: (config: Record<string, unknown>) => ({
          MAX_LOSS_VALUE: 10,
          ...config,
        }),
      })),
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
            strategyRevision: expect.stringMatching(/^sr1:[a-f0-9]{16}$/),
            enabled: true,
            controlState: 'entries_paused',
            selection: { tickers: ['BTCUSDT', 'ETHUSDT'] },
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
        strategyRevision: expect.stringMatching(/^sr1:[a-f0-9]{16}$/),
        deploymentCompositionId: expect.stringMatching(/^dc1:[a-f0-9]{16}$/),
        controlState: 'active',
        interval: '15',
        universe: 'crypto',
        accountId: 'bybit-main',
        strategyPackage: '@tradejs/strategy-double-tap',
        strategyPackageVersion: '3.2.0',
        runtimePackageVersion: '3.2.0',
        selection: { tickers: ['BTCUSDT', 'ETHUSDT'] },
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

  it('rejects an invalid strategy-owned config before resolving runtime', async () => {
    jest.doMock('../strategy', () => ({
      getStrategyEntry: jest.fn(async () => ({
        parseConfig: () => {
          throw new Error('DoubleTap.TRESHOLD is not allowed');
        },
      })),
      getStrategyCreator: jest.fn(async () => jest.fn()),
      getStrategyPluginSource: jest.fn(
        async () => '@tradejs/strategy-double-tap',
      ),
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
    ).rejects.toThrow('DoubleTap.TRESHOLD is not allowed');
  });

  it('rejects a stale package manifest instead of trusting its version', async () => {
    jest.doMock('node:fs/promises', () => ({
      readFile: jest.fn(async (filePath: string) => {
        if (filePath.endsWith('runtime-package-manifest.json')) {
          return JSON.stringify({
            schema: 'tradejs-runtime-package-manifest/v1',
            projectSha: 'a'.repeat(40),
            packages: {
              '@tradejs/strategy-double-tap': '3.1.0',
              '@tradejs/node': '3.2.0',
            },
          });
        }
        if (
          filePath.endsWith(
            'node_modules/@tradejs/strategy-double-tap/package.json',
          )
        ) {
          return JSON.stringify({ version: '3.2.0' });
        }
        if (filePath.endsWith('node_modules/@tradejs/node/package.json')) {
          return JSON.stringify({ version: '3.2.0' });
        }
        throw new Error('not found');
      }),
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
    ).rejects.toThrow(
      'Runtime package manifest mismatch for @tradejs/strategy-double-tap: declared=3.1.0 installed=3.2.0',
    );
  });

  it('computes stable revisions and changes them for semantic input changes', async () => {
    const { computeStrategyRevision } = await import('../runtimeStrategies');
    const base = {
      strategyName: 'DoubleTap',
      strategyPackage: '@tradejs/strategy-double-tap',
      strategyPackageVersion: '3.2.0',
      strategyDependencyVersions: {
        '@tradejs/core': '3.2.0',
        '@tradejs/strategy-kit': '3.0.1',
      },
      runtimePackageVersion: '3.2.0',
      strategyConfig: { INTERVAL: '15', LONG: { enable: true } },
    };

    expect(computeStrategyRevision(base)).toBe(
      computeStrategyRevision({
        ...base,
        strategyConfig: { LONG: { enable: true }, INTERVAL: '15' },
      }),
    );
    expect(computeStrategyRevision(base)).not.toBe(
      computeStrategyRevision({
        ...base,
        strategyPackageVersion: '3.2.1',
      }),
    );
    expect(computeStrategyRevision(base)).not.toBe(
      computeStrategyRevision({
        ...base,
        strategyDependencyVersions: {
          ...base.strategyDependencyVersions,
          '@tradejs/strategy-kit': '3.0.2',
        },
      }),
    );
    expect(computeStrategyRevision(base)).not.toBe(
      computeStrategyRevision({
        ...base,
        strategyConfig: { INTERVAL: '15', LONG: { enable: false } },
      }),
    );
  });

  it('computes the same deployment composition id for reordered sets', async () => {
    const { computeDeploymentCompositionId } = await import(
      '../runtimeStrategies'
    );
    const base = {
      deploymentId: 'production',
      connectorName: 'bybit',
      provider: 'bybit',
      accountId: 'bybit-main',
      enabled: true,
      assetClasses: ['spot', 'linear'],
      strategies: [
        {
          strategyName: 'DoubleTap',
          strategyRevision: 'sr1:0123456789abcdef',
          enabled: true,
          selection: { tickers: ['BTCUSDT', 'ETHUSDT'] },
        },
      ],
    };

    expect(computeDeploymentCompositionId(base)).toBe(
      computeDeploymentCompositionId({
        ...base,
        assetClasses: ['linear', 'spot'],
        strategies: [
          {
            ...base.strategies[0],
            selection: { tickers: ['ETHUSDT', 'BTCUSDT'] },
          },
        ],
      }),
    );
  });

  it.each([
    { tickers: [] },
    { tickers: ['BTCUSDT', 'BTCUSDT'] },
    { tickers: ['BTCUSDT', ' '] },
  ])('rejects an invalid deployment ticker set: %j', async (invalid) => {
    mockLoadTradejsConfig.mockResolvedValueOnce({
      runtime: {
        deployments: {
          production: {
            ...runtimeConfig.deployments.production,
            ...invalid,
          },
        },
      },
    });
    const { listRuntimeDeployments } = await import('../runtimeStrategies');

    await expect(
      listRuntimeDeployments({ userName: 'root', projectRoot: '/project' }),
    ).rejects.toThrow('Invalid runtime deployment declaration');
  });

  it('rejects duplicate strategy-selection tickers', async () => {
    mockLoadTradejsConfig.mockResolvedValueOnce({
      runtime: {
        deployments: {
          production: {
            ...runtimeConfig.deployments.production,
            strategies: {
              DoubleTap: {
                ...runtimeConfig.deployments.production.strategies.DoubleTap,
                selection: { tickers: ['BTCUSDT', 'BTCUSDT'] },
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
            schema: 'tradejs-runtime-package-manifest/v1',
            projectSha: 'a'.repeat(40),
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
        if (filePath.endsWith('node_modules/@tradejs/node/package.json')) {
          return JSON.stringify({ name: '@tradejs/node', version: '3.2.0' });
        }
        throw new Error('not found');
      }),
    }));
    jest.doMock('../strategy', () => ({
      getStrategyEntry: jest.fn(async () => ({
        parseConfig: (config: Record<string, unknown>) => config,
      })),
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
      strategyDependencyVersions: {},
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

  it('rejects a runtime manifest without an exact Project SHA', async () => {
    jest.doMock('node:fs/promises', () => ({
      readFile: jest.fn(async (filePath: string) => {
        if (filePath.endsWith('runtime-package-manifest.json')) {
          return JSON.stringify({
            schema: 'tradejs-runtime-package-manifest/v1',
            projectSha: 'unknown',
            packages: {
              '@tradejs/strategy-double-tap': '3.2.0',
              '@tradejs/node': '3.2.0',
            },
          });
        }
        throw new Error('not found');
      }),
    }));
    const { listRuntimeDeployments } = await import('../runtimeStrategies');

    await expect(
      listRuntimeDeployments({ userName: 'root', projectRoot: '/project' }),
    ).rejects.toThrow('Invalid runtime package manifest');
  });
});
