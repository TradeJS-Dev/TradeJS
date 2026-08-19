describe('signals runtime strategy resolver seam', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('delegates runtime resolution to the shared node module', async () => {
    const loadResolvedRuntimeStrategies = jest.fn(async () => [
      {
        strategyName: 'DoubleTap',
        version: 2,
        controlState: 'active',
      },
    ]);
    jest.doMock('@tradejs/node/runtimeStrategies', () => ({
      loadResolvedRuntimeStrategies,
    }));

    const { loadRuntimeStrategies } = await import(
      '../lib/signals/runtimeStrategies'
    );
    const input = {
      userName: 'root',
      projectRoot: '/project',
      deploymentId: 'production',
    };
    await expect(loadRuntimeStrategies(input)).resolves.toEqual([
      expect.objectContaining({ strategyName: 'DoubleTap', version: 2 }),
    ]);
    expect(loadResolvedRuntimeStrategies).toHaveBeenCalledWith(input);
  });
});
