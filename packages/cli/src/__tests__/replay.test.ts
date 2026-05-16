describe('replay script', () => {
  const previousReplayEnv = process.env.TRADEJS_REPLAY;

  afterEach(() => {
    jest.resetModules();
    if (previousReplayEnv == null) {
      delete process.env.TRADEJS_REPLAY;
    } else {
      process.env.TRADEJS_REPLAY = previousReplayEnv;
    }
  });

  it('enables replay mode and delegates to backtest runner', async () => {
    const backtest = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../scripts/backtest', () => ({
      __esModule: true,
      backtest,
    }));

    const module = await import('../scripts/replay');
    await module.main();

    expect(process.env.TRADEJS_REPLAY).toBe('1');
    expect(backtest).toHaveBeenCalledTimes(1);
  });
});
