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

  it('loads the indicator cache migration command module', async () => {
    const commandMain = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../scripts/indicatorCacheMigrate', () => ({
      __esModule: true,
      main: commandMain,
    }));

    const cli = require('../cli') as {
      main: () => Promise<void>;
    };

    process.argv = ['node', '/tmp/cli.js', 'indicator-cache:migrate'];
    await cli.main();

    expect(commandMain).toHaveBeenCalledTimes(1);
  });

  it('closes shared infra resources after command completion', async () => {
    const commandMain = jest.fn().mockResolvedValue(undefined);
    const closeRedisConnection = jest.fn().mockResolvedValue(undefined);
    const closeTimescalePool = jest.fn().mockResolvedValue(undefined);

    jest.doMock('@tradejs/infra/redis', () => ({
      closeRedisConnection,
    }));
    jest.doMock('@tradejs/infra/timescale', () => ({
      closeTimescalePool,
    }));
    jest.doMock('../scripts/agentRun', () => ({
      __esModule: true,
      main: commandMain,
    }));

    const cli = require('../cli') as {
      main: () => Promise<void>;
    };

    process.argv = ['node', '/tmp/cli.js', 'agent-run'];
    await cli.main();

    expect(commandMain).toHaveBeenCalledTimes(1);
    expect(closeRedisConnection).toHaveBeenCalledTimes(1);
    expect(closeTimescalePool).toHaveBeenCalledTimes(1);
  });

  it('closes shared infra resources when command throws', async () => {
    const closeRedisConnection = jest.fn().mockResolvedValue(undefined);
    const closeTimescalePool = jest.fn().mockResolvedValue(undefined);

    jest.doMock('@tradejs/infra/redis', () => ({
      closeRedisConnection,
    }));
    jest.doMock('@tradejs/infra/timescale', () => ({
      closeTimescalePool,
    }));
    jest.doMock('../scripts/agentRun', () => ({
      __esModule: true,
      main: jest.fn().mockRejectedValue(new Error('boom')),
    }));

    const cli = require('../cli') as {
      main: () => Promise<void>;
    };

    process.argv = ['node', '/tmp/cli.js', 'agent-run'];
    await expect(cli.main()).rejects.toThrow('boom');

    expect(closeRedisConnection).toHaveBeenCalledTimes(1);
    expect(closeTimescalePool).toHaveBeenCalledTimes(1);
  });

  it('requires every CLI command module to export main without self-run side effects', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const cliSource = fs.readFileSync(
      path.resolve(__dirname, '../cli.ts'),
      'utf8',
    );
    const loaderMatches = [
      ...cliSource.matchAll(
        /(?:['"]([^'"]+)['"]|([A-Za-z0-9_-]+)):\s*\(\)\s*=>\s*import\('\.\/scripts\/([^']+)'\)/g,
      ),
    ];

    const commandFiles = loaderMatches.map((match) =>
      path.resolve(__dirname, `../scripts/${match[3]}.ts`),
    );

    for (const commandFile of commandFiles) {
      const source = fs.readFileSync(commandFile, 'utf8');
      expect(source).toMatch(
        /export const main|export async function main|export \{\s*main\s*\}/,
      );
      expect(source).not.toMatch(/require\.main === module/);
      expect(source).not.toMatch(/main\(\)\.catch/);
      expect(source).not.toMatch(/void main\(/);
      expect(source).not.toMatch(/main\(\);/);
    }
  });
});
