describe('strategy manifests registry', () => {
  const loadTradejsConfigMock = jest.fn();
  const registerIndicatorEntriesMock = jest.fn();
  const resetIndicatorRegistryCacheMock = jest.fn();
  const logMock = jest.fn();
  const resetSharedRegistry = () => {
    delete (globalThis as Record<string, unknown>)[
      '__tradejsNodeSharedStrategyRegistryV1__'
    ];
  };

  beforeEach(() => {
    resetSharedRegistry();
    jest.resetModules();
    loadTradejsConfigMock.mockReset();
    registerIndicatorEntriesMock.mockReset();
    resetIndicatorRegistryCacheMock.mockReset();
    logMock.mockReset();
    loadTradejsConfigMock.mockResolvedValue({
      strategies: [],
      indicators: [],
    });
  });

  afterEach(resetSharedRegistry);

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

  it('shares registry state across separately evaluated package entrypoints', async () => {
    const firstEntrypoint = await loadModule();
    firstEntrypoint.registerStrategyEntries([
      {
        manifest: { name: 'SharedStrategy' } as any,
        defaults: {},
        parseConfig: (config: any) => config,
        createCore: jest.fn(async () => ({}) as any),
      },
    ]);

    jest.resetModules();
    const secondEntrypoint = await import('../manifests');

    expect(secondEntrypoint.getStrategyManifest('SharedStrategy')?.name).toBe(
      'SharedStrategy',
    );
  });

  it('starts empty and supports runtime registration + proxy access', async () => {
    const manifests = await loadModule();
    const names = await manifests.getAvailableStrategyNames();

    expect(names).toEqual([]);

    const runtimeCreator = jest.fn(async () => ({}) as any);
    const defaults = { ENABLE: true, INTERVAL: '15' };
    manifests.registerStrategyEntries([
      {
        manifest: { name: 'RuntimeStrategy' } as any,
        defaults,
        parseConfig: (config: any) => config,
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
    expect(await manifests.getStrategyDefaults('RuntimeStrategy')).toBe(
      defaults,
    );
    expect(await manifests.getStrategyDefaults('UnknownStrategy')).toBe(
      undefined,
    );

    expect(() =>
      manifests.registerStrategyEntries([
        {
          manifest: {} as any,
          defaults: {},
          parseConfig: (config: any) => config,
          createCore: runtimeCreator,
        },
        {
          manifest: { name: 'RuntimeStrategy' } as any,
          defaults: {},
          parseConfig: (config: any) => config,
          createCore: runtimeCreator,
        },
      ]),
    ).toThrow(
      [
        'Invalid TradeJS plugin catalog:',
        'runtime.strategyEntries[0]: manifest.name is required',
        'runtime.strategyEntries[1]: duplicate strategy RuntimeStrategy',
      ].join('\n'),
    );

    expect(manifests.getRegisteredStrategies()).toEqual({
      RuntimeStrategy: runtimeCreator,
    });
  });

  it.each([null, [], 'invalid'])(
    'rejects non-object strategy defaults: %p',
    async (defaults) => {
      const manifests = await loadModule();

      expect(() =>
        manifests.registerStrategyEntries([
          {
            manifest: { name: 'InvalidDefaults' } as any,
            defaults: defaults as any,
            parseConfig: (config: any) => config,
            createCore: jest.fn(async () => ({}) as any),
          },
        ]),
      ).toThrow('runtime.strategyEntries[0]: defaults must be an object');
    },
  );

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
            parseConfig: (config: any) => config,
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
              parseConfig: (config: any) => config,
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
    await expect(manifests.ensureStrategyPluginsLoaded()).rejects.toThrow(
      [
        'Invalid TradeJS plugin catalog:',
        'plugin-missing: export { strategyEntries } is missing',
        'plugin-missing: export { indicatorEntries } is missing',
        'plugin-fail: failed to import',
      ].join('\n'),
    );

    expect(registerIndicatorEntriesMock).toHaveBeenCalledTimes(2);
    expect(resetIndicatorRegistryCacheMock).toHaveBeenCalledTimes(1);
    expect(loadTradejsConfigMock).toHaveBeenCalledTimes(1);

    expect(manifests.getRegisteredStrategies()).toMatchObject({
      PluginValid: pluginCreator,
      PluginDefault: defaultCreator,
    });
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
          parseConfig: (config: any) => config,
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
          parseConfig: (config: any) => config,
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

  it('rejects a strategy plugin with a primitive export payload', async () => {
    jest.doMock('plugin-primitive-export', () => 123, { virtual: true });
    loadTradejsConfigMock.mockResolvedValue({
      strategies: ['plugin-primitive-export'],
      indicators: [],
    });

    const manifests = await loadModule();
    await expect(manifests.ensureStrategyPluginsLoaded()).rejects.toThrow(
      'plugin-primitive-export: export { strategyEntries } is missing',
    );
  });

  it('resetStrategyRegistryCache clears runtime entries and allows reload', async () => {
    jest.doMock(
      'plugin-one',
      () => ({
        strategyEntries: [
          {
            manifest: { name: 'PluginOne' } as any,
            defaults: {},
            parseConfig: (config: any) => config,
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
