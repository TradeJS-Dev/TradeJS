describe('replay script', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('delegates to dedicated replay backtest runner', async () => {
    const replayBacktest = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../scripts/backtest', () => ({
      __esModule: true,
      replayBacktest,
    }));

    const module = await import('../scripts/replay');
    await module.main();

    expect(replayBacktest).toHaveBeenCalledTimes(1);
  });
});
