describe('backtest market universe CLI config', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const importConfig = async (universe: unknown) => {
    jest.resetModules();
    jest.doMock('args', () => ({
      __esModule: true,
      default: {
        example: jest.fn(),
        option: jest.fn(),
        parse: jest.fn(() => ({
          timeframe: 15,
          universe,
          progressStep: 100,
          tests: 1,
          skip: 0,
          parallel: 1,
          user: 'root',
        })),
      },
    }));
    jest.doMock('../lib/cliArgs', () => ({
      normalizeCliArgv: jest.fn((argv: string[]) => argv),
    }));
    return import('../lib/backtest/cliConfig');
  };

  it.each(['crypto', 'tradfi'] as const)(
    'accepts supported universe %s',
    async (universe) => {
      const config = await importConfig(universe);
      expect(config.marketUniverse).toBe(universe);
    },
  );

  it('rejects an unknown universe before starting workers', async () => {
    await expect(importConfig('stocks')).rejects.toThrow(
      'Unknown market universe: stocks',
    );
  });
});
