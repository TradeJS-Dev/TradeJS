describe('strategy manifests registry', () => {
  const loadTradejsConfigMock = jest.fn();
  const registerIndicatorEntriesMock = jest.fn();
  const warnMock = jest.fn();
  const logMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    loadTradejsConfigMock.mockReset();
    registerIndicatorEntriesMock.mockReset();
    warnMock.mockReset();
    logMock.mockReset();
    loadTradejsConfigMock.mockResolvedValue({
      strategyPlugins: [],
      indicatorsPlugins: [],
    });
  });

  const loadModule = async () => {
    jest.doMock('@utils/tradejsConfig', () => ({
      loadTradejsConfig: loadTradejsConfigMock,
    }));
    jest.doMock('@tradejs/core/indicators', () => ({
      registerIndicatorEntries: registerIndicatorEntriesMock,
    }));
    jest.doMock('@utils/logger', () => ({
      logger: {
        warn: warnMock,
        log: logMock,
      },
    }));

    return import('../manifests');
  };

  it('exposes built-ins and supports runtime registration + proxy access', async () => {
    const manifests = await loadModule();
    const names = await manifests.getAvailableStrategyNames();

    expect(names).toEqual(
      expect.arrayContaining([
        'AdaptiveMomentumRibbon',
        'Breakout',
        'MaStrategy',
        'TrendLine',
        'VolumeDivergence',
      ]),
    );

    const runtimeCreator = jest.fn(async () => ({}) as any);
    manifests.registerStrategyEntries([
      {
        manifest: { name: 'RuntimeStrategy' } as any,
        creator: runtimeCreator,
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
        creator: runtimeCreator,
      },
      {
        manifest: { name: 'RuntimeStrategy' } as any,
        creator: runtimeCreator,
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
            creator: pluginCreator,
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
              creator: defaultCreator,
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
      strategyPlugins: [
        ' plugin-valid ',
        'plugin-missing',
        'plugin-default',
        'plugin-valid',
        'plugin-fail',
      ],
      indicatorsPlugins: ['plugin-valid', 'plugin-default', 'plugin-missing'],
    });

    const manifests = await loadModule();
    await manifests.ensureStrategyPluginsLoaded();

    const names = await manifests.getAvailableStrategyNames();
    expect(names).toEqual(
      expect.arrayContaining(['PluginValid', 'PluginDefault']),
    );
    expect(await manifests.getStrategyCreator('PluginValid')).toBe(
      pluginCreator,
    );
    expect(await manifests.getStrategyCreator('Unknown')).toBeUndefined();

    expect(registerIndicatorEntriesMock).toHaveBeenCalledTimes(2);
    expect(loadTradejsConfigMock).toHaveBeenCalledTimes(1);

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
});
