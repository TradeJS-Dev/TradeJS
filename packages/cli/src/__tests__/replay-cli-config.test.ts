describe('replay cli config', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('parses only replay-specific flags', async () => {
    process.argv = [
      'node',
      '/tmp/cli.js',
      'replay',
      '--days',
      '7',
      '--timeframe',
      '60',
      '--tickers',
      'BTCUSDT',
      '--deployment',
      'production',
    ];

    const module = await import('../lib/replay/cliConfig');

    expect(module.replayFlags.days).toBe(7);
    expect(module.replayInterval).toBe('60');
    expect(module.replayFlags.tickers).toBe('BTCUSDT');
    expect(module.replayDeploymentId).toBe('production');
  });

  it('rejects inherited backtest worker flags', async () => {
    process.argv = ['node', '/tmp/cli.js', 'replay', '--parallel', '4'];

    await expect(import('../lib/replay/cliConfig')).rejects.toThrow(
      '`yarn replay` does not use backtest worker parallelism.',
    );
  });
});
