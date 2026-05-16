describe('cli loader', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    jest.resetModules();
    process.argv = [...originalArgv];
  });

  afterAll(() => {
    process.argv = originalArgv;
  });

  it('invokes exported main from dynamically loaded command module', async () => {
    const commandMain = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../scripts/agentRun', () => ({
      __esModule: true,
      main: commandMain,
    }));

    const cli = require('../cli') as {
      main: () => Promise<void>;
    };

    process.argv = ['node', '/tmp/cli.js', 'agent-run', '--json'];
    await cli.main();

    expect(commandMain).toHaveBeenCalledTimes(1);
  });

  it('loads the replay command module', async () => {
    const commandMain = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../scripts/replay', () => ({
      __esModule: true,
      main: commandMain,
    }));

    const cli = require('../cli') as {
      main: () => Promise<void>;
    };

    process.argv = ['node', '/tmp/cli.js', 'replay', '--days', '7'];
    await cli.main();

    expect(commandMain).toHaveBeenCalledTimes(1);
  });
});
