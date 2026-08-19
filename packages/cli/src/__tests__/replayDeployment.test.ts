describe('replay deployment composition', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('loads only enabled strategies from the Git-owned deployment', async () => {
    const deployment = {
      id: 'production',
      label: 'Production',
      connectorName: 'bybit',
      provider: 'bybit',
      accountId: 'bybit-default',
      enabled: true,
      strategies: [],
    };
    const getRuntimeDeployment = jest.fn(async () => deployment);
    const loadResolvedRuntimeStrategies = jest.fn(async () => [
      {
        strategyName: 'DoubleTap',
        version: 5,
        enabled: true,
        strategyPackage: '@tradejs/strategy-double-tap',
        strategyPackageVersion: '3.0.1',
        runtimePackageVersion: '3.2.0',
        sourceStrategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
      },
      {
        strategyName: 'TrendShift',
        version: 1,
        enabled: false,
        strategyPackage: '@tradejs/strategy-trend-shift',
        strategyPackageVersion: '3.0.0',
        runtimePackageVersion: '3.2.0',
        sourceStrategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
      },
    ]);
    jest.doMock('@tradejs/node/runtimeStrategies', () => ({
      getRuntimeDeployment,
      loadResolvedRuntimeStrategies,
    }));

    const { loadDeploymentReplayStrategies } = await import(
      '../lib/runEnvironment'
    );
    await expect(
      loadDeploymentReplayStrategies({
        userName: 'root',
        projectRoot: '/project',
        deploymentId: 'production',
      }),
    ).resolves.toEqual({
      deployment,
      strategies: [
        {
          strategyName: 'DoubleTap',
          version: 5,
          strategyPackage: '@tradejs/strategy-double-tap',
          strategyPackageVersion: '3.0.1',
          runtimePackageVersion: '3.2.0',
          strategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
        },
      ],
    });
  });
});
