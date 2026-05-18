describe('backtest live flag removal', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    jest.resetModules();
    process.argv = ['node', '/tmp/cli.js', 'backtest', '--live', '--days', '1'];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('throws a migration hint when legacy --live is used', async () => {
    jest.doMock('@tradejs/connectors', () => ({
      ConnectorNames: {
        Binance: 'Binance',
        Coinbase: 'Coinbase',
      },
    }));

    jest.doMock('args', () => ({
      __esModule: true,
      default: {
        example: jest.fn(),
        option: jest.fn(),
        parse: jest.fn(() => ({})),
      },
    }));

    jest.doMock('../lib/cliArgs', () => ({
      normalizeCliArgv: jest.fn((argv: string[]) => argv),
    }));

    await expect(import('../scripts/backtest')).rejects.toThrow(
      '`--live` was removed from `yarn backtest`. Use `yarn replay` instead.',
    );
  });
});
