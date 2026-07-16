describe('infra-up', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('waits for the dev services to become ready', async () => {
    const requireDevComposeFile = jest.fn(
      () => '/project/docker-compose.dev.yml',
    );
    const runDockerCompose = jest.fn();

    jest.doMock('../scripts/infraCommon', () => ({
      requireDevComposeFile,
      runDockerCompose,
    }));

    const { main } = await import('../scripts/infraUp');
    await main();

    expect(requireDevComposeFile).toHaveBeenCalledTimes(1);
    expect(runDockerCompose).toHaveBeenCalledWith(
      '/project/docker-compose.dev.yml',
      ['up', '-d', '--wait', '--wait-timeout', '120', 'timescale', 'redis'],
    );
  });
});
