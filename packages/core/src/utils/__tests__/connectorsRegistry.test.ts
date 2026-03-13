describe('connectors registry', () => {
  const loadTradejsConfigMock = jest.fn();
  const warnMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    loadTradejsConfigMock.mockReset();
    warnMock.mockReset();
    loadTradejsConfigMock.mockResolvedValue({
      connectors: [],
    });
  });

  const loadModule = async () => {
    jest.doMock('@utils/tradejsConfig', () => ({
      loadTradejsConfig: loadTradejsConfigMock,
      resolvePluginModuleSpecifier: (moduleName: string) => moduleName,
    }));

    jest.doMock('@tradejs/infra', () => ({
      logger: {
        warn: warnMock,
      },
    }));

    const module = await import('../connectorsRegistry');
    return { module };
  };

  it('starts empty when no connector plugins configured', async () => {
    const { module } = await loadModule();

    expect(await module.getConnectorNameByProvider('bybit')).toBeUndefined();
    expect(await module.getConnectorCreatorByName('ByBit')).toBeUndefined();
    expect(await module.getAvailableConnectorProviders()).toEqual([]);
    expect(await module.getAvailableConnectorNames()).toEqual([]);
  });

  it('loads connector plugins once and supports default exports + aliases', async () => {
    const pluginCreator = jest.fn(async () => ({}) as any);
    const defaultCreator = jest.fn(async () => ({}) as any);

    jest.doMock(
      'connector-plugin-valid',
      () => ({
        connectorEntries: [
          {
            name: 'PluginConnector',
            creator: pluginCreator,
            providers: ['pluginx', 'plugin-x'],
          },
        ],
      }),
      { virtual: true },
    );

    jest.doMock(
      'connector-plugin-default',
      () => ({
        __esModule: true,
        default: {
          connectorEntries: [
            {
              name: 'DefaultConnector',
              creator: defaultCreator,
            },
          ],
        },
      }),
      { virtual: true },
    );

    jest.doMock('connector-plugin-missing', () => ({}), { virtual: true });

    loadTradejsConfigMock.mockResolvedValue({
      connectors: [
        ' connector-plugin-valid ',
        'connector-plugin-missing',
        'connector-plugin-default',
        'connector-plugin-valid',
        'connector-plugin-fail',
      ],
    });

    const { module } = await loadModule();

    expect(await module.getConnectorCreatorByProvider('pluginx')).toBe(
      pluginCreator,
    );
    expect(await module.getConnectorCreatorByProvider('plugin-x')).toBe(
      pluginCreator,
    );
    expect(await module.resolveConnectorName('defaultconnector')).toBe(
      'DefaultConnector',
    );

    await module.ensureConnectorPluginsLoaded();
    expect(loadTradejsConfigMock).toHaveBeenCalledTimes(1);
    await module.ensureConnectorPluginsLoaded();
    expect(loadTradejsConfigMock).toHaveBeenCalledTimes(1);

    const warnMessages = warnMock.mock.calls.map((call) => String(call[0]));
    expect(
      warnMessages.some((message) => message.includes('Skip connector plugin')),
    ).toBe(true);
    expect(
      warnMessages.some((message) =>
        message.includes('Failed to load connector plugin'),
      ),
    ).toBe(true);
  });

  it('supports runtime connector registration and registry reset', async () => {
    const { module } = await loadModule();
    const runtimeCreator = jest.fn(async () => ({}) as any);

    module.registerConnectorEntries([
      {
        name: 'RuntimeConnector',
        creator: runtimeCreator,
        providers: ['runtime-provider'],
      },
    ]);

    expect(await module.getConnectorNameByProvider('runtime-provider')).toBe(
      'RuntimeConnector',
    );
    expect(await module.getConnectorCreatorByName('RuntimeConnector')).toBe(
      runtimeCreator,
    );

    module.resetConnectorRegistryCache();

    expect(await module.getConnectorNameByProvider('runtime-provider')).toBe(
      undefined,
    );
  });
});
