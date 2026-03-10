describe('connectors registry', () => {
  const loadTradejsConfigMock = jest.fn();
  const warnMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    loadTradejsConfigMock.mockReset();
    warnMock.mockReset();
    loadTradejsConfigMock.mockResolvedValue({
      connectorsPlugins: [],
    });
  });

  const loadModule = async () => {
    const byBitCreator = jest.fn(async () => ({}) as any);
    const binanceCreator = jest.fn(async () => ({}) as any);
    const coinbaseCreator = jest.fn(async () => ({}) as any);
    const testCreator = jest.fn();

    jest.doMock('@tradejs/connectors', () => ({
      ConnectorNames: {
        ByBit: 'ByBit',
        Binance: 'Binance',
        Coinbase: 'Coinbase',
        Test: 'Test',
      },
      connectors: {
        ByBit: byBitCreator,
        Binance: binanceCreator,
        Coinbase: coinbaseCreator,
        Test: testCreator,
      },
      providerToConnectorName: {
        bybit: 'ByBit',
        binance: 'Binance',
        coinbase: 'Coinbase',
      },
    }));

    jest.doMock('@utils/tradejsConfig', () => ({
      loadTradejsConfig: loadTradejsConfigMock,
      resolvePluginModuleSpecifier: (moduleName: string) => moduleName,
    }));

    jest.doMock('@utils/logger', () => ({
      logger: {
        warn: warnMock,
      },
    }));

    const module = await import('../connectorsRegistry');
    return {
      module,
      byBitCreator,
      binanceCreator,
      coinbaseCreator,
      testCreator,
    };
  };

  it('resolves built-in connectors by provider and name', async () => {
    const { module, byBitCreator, binanceCreator, coinbaseCreator } =
      await loadModule();

    expect(await module.getConnectorNameByProvider('bybit')).toBe('ByBit');
    expect(await module.getConnectorNameByProvider('BINANCE')).toBe('Binance');

    expect(await module.resolveConnectorName('coinbase')).toBe('Coinbase');
    expect(await module.resolveConnectorName('Coinbase')).toBe('Coinbase');

    expect(await module.getConnectorCreatorByProvider('bybit')).toBe(
      byBitCreator,
    );
    expect(await module.getConnectorCreatorByName('binance')).toBe(
      binanceCreator,
    );
    expect(await module.getConnectorCreatorByName('Coinbase')).toBe(
      coinbaseCreator,
    );

    const providers = await module.getAvailableConnectorProviders();
    expect(providers).toEqual(['binance', 'bybit', 'coinbase']);
    const names = await module.getAvailableConnectorNames();
    expect(names).toEqual(['Binance', 'ByBit', 'Coinbase']);
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
      connectorsPlugins: [
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
    expect(await module.getConnectorNameByProvider('bybit')).toBe('ByBit');
  });
});
