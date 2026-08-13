describe('strategy manifests registry', () => {
  const loadTradejsConfigMock = jest.fn();
  const registerIndicatorEntriesMock = jest.fn();
  const resetIndicatorRegistryCacheMock = jest.fn();
  const warnMock = jest.fn();
  const logMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    loadTradejsConfigMock.mockReset();
    registerIndicatorEntriesMock.mockReset();
    resetIndicatorRegistryCacheMock.mockReset();
    warnMock.mockReset();
    logMock.mockReset();
    loadTradejsConfigMock.mockResolvedValue({
      strategies: [],
      indicators: [],
    });
  });

  const loadModule = async () => {
    jest.doMock('../../tradejsConfig', () => ({
      getTradejsProjectCwd: (cwd?: string) => cwd || '/tmp/test-project',
      loadTradejsConfig: loadTradejsConfigMock,
      resolvePluginModuleSpecifier: (moduleName: string) => moduleName,
    }));
    jest.doMock('@tradejs/core/indicators', () => ({
      registerIndicatorEntries: registerIndicatorEntriesMock,
      resetIndicatorRegistryCache: resetIndicatorRegistryCacheMock,
    }));
    jest.doMock('@tradejs/infra/logger', () => ({
      logger: {
        warn: warnMock,
        log: logMock,
      },
    }));
    jest.doMock('../../strategyRuntime', () => ({
      createStrategyRuntime: ({ createCore }: { createCore: unknown }) =>
        createCore,
    }));

    const manifests = await import('../manifests');
    const { createStrategyRuntime } = await import('../../strategyRuntime');
    manifests.setStrategyRuntimeFactory(createStrategyRuntime as any);
    return manifests;
  };

  it('starts empty and supports runtime registration + proxy access', async () => {
    const manifests = await loadModule();
    const names = await manifests.getAvailableStrategyNames();

    expect(names).toEqual([]);

    const runtimeCreator = jest.fn(async () => ({}) as any);
    manifests.registerStrategyEntries([
      {
        manifest: { name: 'RuntimeStrategy' } as any,
        defaults: {},
        createCore: runtimeCreator,
      },
    ]);

    expect(manifests.isKnownStrategy('RuntimeStrategy')).toBe(true);
    expect(manifests.getStrategyManifest('RuntimeStrategy')?.name).toBe(
      'RuntimeStrategy',
    );
    expect(manifests.getRegisteredStrategies().RuntimeStrategy).toBe(
      runtimeCreator,
    );
    expect(manifests.strategies.RuntimeStrategy).toBe(runtimeCreator);
    expect(Object.keys(manifests.strategies)).toContain('RuntimeStrategy');

    manifests.registerStrategyEntries([
      {
        manifest: {} as any,
        defaults: {},
        createCore: runtimeCreator,
      },
      {
        manifest: { name: 'RuntimeStrategy' } as any,
        defaults: {},
        createCore: runtimeCreator,
      },
    ]);

    const warnMessages = warnMock.mock.calls.map((call) => String(call[0]));
    expect(
      warnMessages.some((message) =>
        message.includes('Skip strategy entry without name'),
      ),
    ).toBe(true);
    expect(
      warnMessages.some((message) =>
        message.includes('Skip duplicate strategy'),
      ),
    ).toBe(true);
  });

  it('loads strategy/indicator plugins once and handles missing exports and failures', async () => {
    const pluginCreator = jest.fn(async () => ({}) as any);
    const defaultCreator = jest.fn(async () => ({}) as any);

    jest.doMock(
      'plugin-valid',
      () => ({
        strategyEntries: [
          {
            manifest: { name: 'PluginValid' } as any,
            defaults: {},
            createCore: pluginCreator,
          },
        ],
        indicatorEntries: [
          {
            indicator: {
              id: 'pluginValidIndicator',
              label: 'PVI',
              enabled: true,
            },
            historyKey: 'pluginValidIndicator',
            compute: () => 1,
          },
        ],
      }),
      { virtual: true },
    );

    jest.doMock(
      'plugin-default',
      () => ({
        __esModule: true,
        default: {
          strategyEntries: [
            {
              manifest: { name: 'PluginDefault' } as any,
              defaults: {},
              createCore: defaultCreator,
            },
          ],
          indicatorEntries: [
            {
              indicator: {
                id: 'pluginDefaultIndicator',
                label: 'PDI',
                enabled: true,
              },
              historyKey: 'pluginDefaultIndicator',
              compute: () => 2,
            },
          ],
        },
      }),
      { virtual: true },
    );

    jest.doMock('plugin-missing', () => ({}), { virtual: true });

    loadTradejsConfigMock.mockResolvedValue({
      strategies: [
        ' plugin-valid ',
        'plugin-missing',
        'plugin-default',
        'plugin-valid',
        'plugin-fail',
      ],
      indicators: ['plugin-valid', 'plugin-default', 'plugin-missing'],
    });

    const manifests = await loadModule();
    await manifests.ensureStrategyPluginsLoaded();

    expect(registerIndicatorEntriesMock).toHaveBeenCalledTimes(2);
    expect(resetIndicatorRegistryCacheMock).toHaveBeenCalledTimes(1);
    expect(loadTradejsConfigMock).toHaveBeenCalledTimes(1);

    const names = await manifests.getAvailableStrategyNames();
    expect(names).toEqual(
      expect.arrayContaining(['PluginValid', 'PluginDefault']),
    );
    expect(await manifests.getStrategyCreator('PluginValid')).toBe(
      pluginCreator,
    );
    expect(await manifests.getStrategyCreator('Unknown')).toBeUndefined();

    await manifests.ensureStrategyPluginsLoaded();
    expect(loadTradejsConfigMock).toHaveBeenCalledTimes(1);

    const warnMessages = warnMock.mock.calls.map((call) => String(call[0]));
    expect(
      warnMessages.some((message) => message.includes('Skip strategy plugin')),
    ).toBe(true);
    expect(
      warnMessages.some((message) => message.includes('Skip indicator plugin')),
    ).toBe(true);
    expect(
      warnMessages.some((message) => message.includes('Failed to load plugin')),
    ).toBe(true);
  });

  it('keeps strategy registry state isolated per project root', async () => {
    const manifests = await loadModule();
    const creatorA = jest.fn(async () => ({}) as any);
    const creatorB = jest.fn(async () => ({}) as any);

    manifests.registerStrategyEntries(
      [
        {
          manifest: { name: 'SandboxStrategy' } as any,
          defaults: {},
          createCore: creatorA,
        },
      ],
      '/tmp/project-a',
    );
    manifests.registerStrategyEntries(
      [
        {
          manifest: { name: 'SandboxStrategy' } as any,
          defaults: {},
          createCore: creatorB,
        },
      ],
      '/tmp/project-b',
    );

    expect(
      manifests.getRegisteredStrategies('/tmp/project-a').SandboxStrategy,
    ).toBe(creatorA);
    expect(
      manifests.getRegisteredStrategies('/tmp/project-b').SandboxStrategy,
    ).toBe(creatorB);

    manifests.resetStrategyRegistryCache('/tmp/project-a');

    expect(manifests.getRegisteredStrategies('/tmp/project-a')).toEqual({});
    expect(
      manifests.getRegisteredStrategies('/tmp/project-b').SandboxStrategy,
    ).toBe(creatorB);
  });

  it('warns for strategy plugin module with primitive export payload', async () => {
    jest.doMock('plugin-primitive-export', () => 123, { virtual: true });
    loadTradejsConfigMock.mockResolvedValue({
      strategies: ['plugin-primitive-export'],
      indicators: [],
    });

    const manifests = await loadModule();
    await manifests.ensureStrategyPluginsLoaded();

    const warnMessages = warnMock.mock.calls.map((call) => String(call[0]));
    expect(
      warnMessages.some((message) => message.includes('Skip strategy plugin')),
    ).toBe(true);
  });

  it('resetStrategyRegistryCache clears runtime entries and allows reload', async () => {
    jest.doMock(
      'plugin-one',
      () => ({
        strategyEntries: [
          {
            manifest: { name: 'PluginOne' } as any,
            defaults: {},
            createCore: jest.fn(async () => ({}) as any),
          },
        ],
      }),
      { virtual: true },
    );

    loadTradejsConfigMock.mockResolvedValue({
      strategies: ['plugin-one'],
      indicators: [],
    });

    const manifests = await loadModule();
    await manifests.ensureStrategyPluginsLoaded();
    expect(await manifests.getAvailableStrategyNames()).toEqual(['PluginOne']);

    manifests.resetStrategyRegistryCache();
    expect(manifests.getRegisteredStrategies()).toEqual({});

    await manifests.ensureStrategyPluginsLoaded();
    expect(await manifests.getAvailableStrategyNames()).toEqual(['PluginOne']);
  });
});
