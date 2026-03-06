const warnMock = jest.fn();

const loadRegistry = () => {
  jest.resetModules();
  jest.doMock('@utils/logger', () => ({
    logger: {
      warn: (...args: unknown[]) => warnMock(...args),
    },
  }));

  return require('../registry') as typeof import('../registry');
};

describe('indicator registry', () => {
  beforeEach(() => {
    warnMock.mockReset();
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
      'Skip indicator entry without id from %s',
      'plugin-a',
    );
    expect(warnMock).toHaveBeenCalledWith(
      'Skip duplicate indicator "%s" from %s: already registered',
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
});
