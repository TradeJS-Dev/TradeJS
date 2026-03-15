const warnMock = jest.fn();
let warnSpy: jest.SpyInstance<void, [message?: any, ...optionalParams: any[]]>;

const loadRegistry = () => {
  jest.resetModules();

  return require('../registry') as typeof import('../registry');
};

describe('indicator registry', () => {
  beforeEach(() => {
    warnMock.mockReset();
    warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation((...args: unknown[]) => {
        warnMock(...args);
      });
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('registers entries and skips items without id and duplicates', () => {
    const {
      registerIndicatorEntries,
      getRegisteredIndicatorEntries,
      getPluginIndicatorCatalog,
    } = loadRegistry();

    const renderer = jest.fn();

    registerIndicatorEntries(
      [
        {
          indicator: {
            id: '',
            label: 'No id',
            enabled: true,
            periods: [5],
          },
        } as any,
        {
          indicator: {
            id: 'sma_custom',
            label: 'SMA Custom',
            enabled: true,
            periods: [10, 20],
          },
          renderer,
        },
      ],
      'plugin-a',
    );

    registerIndicatorEntries(
      [
        {
          indicator: {
            id: 'sma_custom',
            label: 'Duplicate',
            enabled: false,
            periods: [1],
          },
        },
      ] as any,
      'plugin-b',
    );

    const entries = getRegisteredIndicatorEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.indicator.id).toBe('sma_custom');

    const catalog = getPluginIndicatorCatalog();
    expect(catalog).toEqual([
      {
        id: 'sma_custom',
        label: 'SMA Custom',
        enabled: true,
        periods: [10, 20],
      },
    ]);

    expect(warnMock).toHaveBeenCalledWith(
      '[core:indicators] Skip indicator entry without id from %s',
      'plugin-a',
    );
    expect(warnMock).toHaveBeenCalledWith(
      '[core:indicators] Skip duplicate indicator "%s" from %s: already registered',
      'sma_custom',
      'plugin-b',
    );
  });

  it('returns only entries with renderer in getPluginIndicatorRenderers', () => {
    const { registerIndicatorEntries, getPluginIndicatorRenderers } =
      loadRegistry();

    const renderer = jest.fn();

    registerIndicatorEntries(
      [
        {
          indicator: {
            id: 'with_renderer',
            label: 'With renderer',
            enabled: true,
            periods: [14],
          },
          renderer,
        },
        {
          indicator: {
            id: 'without_renderer',
            label: 'Without renderer',
            enabled: true,
            periods: [20],
          },
        },
      ] as any,
      'plugin-c',
    );

    expect(getPluginIndicatorRenderers()).toEqual([
      {
        indicatorId: 'with_renderer',
        renderer,
      },
    ]);
  });

  it('keeps indicator registry state isolated per scope', () => {
    const {
      registerIndicatorEntries,
      getRegisteredIndicatorEntries,
      getPluginIndicatorCatalog,
      getPluginIndicatorRenderers,
    } = loadRegistry();

    const rendererA = jest.fn();
    const rendererB = jest.fn();

    registerIndicatorEntries(
      [
        {
          indicator: {
            id: 'scoped_indicator',
            label: 'Scoped A',
            enabled: true,
            periods: [5],
          },
          renderer: rendererA,
        },
      ] as any,
      'plugin-a',
      '/tmp/project-a',
    );

    registerIndicatorEntries(
      [
        {
          indicator: {
            id: 'scoped_indicator',
            label: 'Scoped B',
            enabled: true,
            periods: [10],
          },
          renderer: rendererB,
        },
      ] as any,
      'plugin-b',
      '/tmp/project-b',
    );

    expect(getRegisteredIndicatorEntries('/tmp/project-a')).toHaveLength(1);
    expect(getRegisteredIndicatorEntries('/tmp/project-b')).toHaveLength(1);
    expect(getPluginIndicatorCatalog('/tmp/project-a')).toEqual([
      {
        id: 'scoped_indicator',
        label: 'Scoped A',
        enabled: true,
        periods: [5],
      },
    ]);
    expect(getPluginIndicatorCatalog('/tmp/project-b')).toEqual([
      {
        id: 'scoped_indicator',
        label: 'Scoped B',
        enabled: true,
        periods: [10],
      },
    ]);
    expect(getPluginIndicatorRenderers('/tmp/project-a')).toEqual([
      {
        indicatorId: 'scoped_indicator',
        renderer: rendererA,
      },
    ]);
    expect(getPluginIndicatorRenderers('/tmp/project-b')).toEqual([
      {
        indicatorId: 'scoped_indicator',
        renderer: rendererB,
      },
    ]);
  });
});
