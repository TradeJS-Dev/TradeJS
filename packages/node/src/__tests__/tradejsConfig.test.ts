import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  getTradejsProjectCwd,
  importTradejsModule,
  loadTradejsConfig,
  resetTradejsConfigCache,
  resolvePluginModuleSpecifier,
} from '../tradejsConfig';

const loggerLogMock = jest.fn();

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: (...args: unknown[]) => loggerLogMock(...args),
  },
}));

const createTempDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'tradejs-config-test-'));

describe('tradejsConfig utils', () => {
  beforeEach(() => {
    resetTradejsConfigCache();
    loggerLogMock.mockReset();
  });

  it('returns empty config when no config file exists', async () => {
    const cwd = createTempDir();

    const config = await loadTradejsConfig(cwd);

    expect(config).toEqual({});
    expect(loggerLogMock).not.toHaveBeenCalled();
  });

  it('loads .ts config and normalizes plugin arrays', async () => {
    const cwd = createTempDir();
    const configPath = path.join(cwd, 'tradejs.config.ts');

    fs.writeFileSync(
      configPath,
      `export default {
  strategies: [' alpha ', '', null, 10],
  indicators: ['beta', '  ', undefined],
  connectors: ['connector-a', '  ', null, 20]
};`,
      'utf8',
    );

    const config = await loadTradejsConfig(cwd);

    expect(config).toEqual({
      strategies: ['alpha', '10'],
      indicators: ['beta'],
      connectors: ['connector-a', '20'],
    });
    expect(loggerLogMock).toHaveBeenCalledWith(
      'debug',
      'Loaded TradeJS config: %s',
      configPath,
    );
  });

  it('preserves function hooks from config files', async () => {
    const cwd = createTempDir();
    const configPath = path.join(cwd, 'tradejs.config.ts');

    fs.writeFileSync(
      configPath,
      `const beforePlaceOrder = async () => {};
const afterCoreDecision = async () => {};
const afterBarDecision = async () => {};

export default {
  hooks: {
    beforePlaceOrder,
    afterCoreDecision,
    afterBarDecision,
  },
};`,
      'utf8',
    );

    const config = await loadTradejsConfig(cwd);

    expect(Array.isArray(config.hooks?.beforePlaceOrder)).toBe(true);
    expect(Array.isArray(config.hooks?.afterCoreDecision)).toBe(true);
    expect(Array.isArray(config.hooks?.afterBarDecision)).toBe(true);
    expect(typeof (config.hooks?.beforePlaceOrder as any)?.[0]).toBe(
      'function',
    );
    expect(typeof (config.hooks?.afterCoreDecision as any)?.[0]).toBe(
      'function',
    );
    expect(typeof (config.hooks?.afterBarDecision as any)?.[0]).toBe(
      'function',
    );
    expect(loggerLogMock).toHaveBeenCalledWith(
      'debug',
      'Loaded TradeJS config: %s',
      configPath,
    );
  });

  it('finds tradejs.config.ts in parent directories', async () => {
    const cwd = createTempDir();
    const childDir = path.join(cwd, 'nested', 'project');
    fs.mkdirSync(childDir, { recursive: true });
    const configPath = path.join(cwd, 'tradejs.config.ts');

    fs.writeFileSync(
      configPath,
      `export default { strategies: ['@tradejs/strategies'] };`,
      'utf8',
    );

    const config = await loadTradejsConfig(childDir);

    expect(config).toEqual({
      strategies: ['@tradejs/strategies'],
      indicators: [],
      connectors: [],
    });
    expect(loggerLogMock).toHaveBeenCalledWith(
      'debug',
      'Loaded TradeJS config: %s',
      configPath,
    );
  });

  it('uses PROJECT_CWD when cwd is not passed', async () => {
    const cwd = createTempDir();
    const configPath = path.join(cwd, 'tradejs.config.ts');
    const previousProjectCwd = process.env.PROJECT_CWD;

    fs.writeFileSync(
      configPath,
      `export default { strategies: ['env-config'] };`,
      'utf8',
    );

    try {
      process.env.PROJECT_CWD = cwd;

      const config = await loadTradejsConfig();

      expect(config).toEqual({
        strategies: ['env-config'],
        indicators: [],
        connectors: [],
      });
    } finally {
      process.env.PROJECT_CWD = previousProjectCwd;
    }
  });

  it('resolves local plugin paths to absolute file paths and keeps package names as-is', () => {
    const cwd = path.join('/tmp', 'tradejs-project');
    const relative = './plugins/my-connector.plugin.ts';
    const absolute = path.join(cwd, 'plugins/my-connector.plugin.ts');
    const absoluteFileUrl = pathToFileURL(absolute).href;

    expect(resolvePluginModuleSpecifier('@scope/plugin', cwd)).toBe(
      '@scope/plugin',
    );
    expect(resolvePluginModuleSpecifier(relative, cwd)).toBe(absolute);
    expect(resolvePluginModuleSpecifier(absolute, cwd)).toBe(absolute);
    expect(resolvePluginModuleSpecifier(absoluteFileUrl, cwd)).toBe(absolute);
  });

  it('loads bare package specifiers via runtime module loader', async () => {
    const moduleExports = (await importTradejsModule(
      'path',
    )) as typeof import('path');

    expect(typeof moduleExports.join).toBe('function');
    expect(moduleExports.join('a', 'b')).toBe(path.join('a', 'b'));
  });

  it('loads ts config that imports workspace modules via tsconfig paths', async () => {
    const cwd = createTempDir();
    const configPath = path.join(cwd, 'tradejs.config.ts');
    const tsconfigPath = path.join(cwd, 'tsconfig.json');
    const baseModulePath = path.join(cwd, 'packages', 'base', 'src');

    fs.mkdirSync(baseModulePath, { recursive: true });
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@tradejs/base': ['./packages/base/src/index.ts'],
          },
        },
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(baseModulePath, 'index.ts'),
      `export const basePreset = { connectors: ['@tradejs/connectors'] };`,
      'utf8',
    );
    fs.writeFileSync(
      configPath,
      `import { basePreset } from '@tradejs/base'; export default basePreset;`,
      'utf8',
    );

    const config = await loadTradejsConfig(cwd);

    expect(config).toEqual(
      expect.objectContaining({
        strategies: ['@tradejs/strategies'],
        indicators: ['@tradejs/indicators'],
        connectors: ['@tradejs/connectors'],
      }),
    );
    expect(loggerLogMock).toHaveBeenCalledWith(
      'debug',
      'Loaded TradeJS config: %s',
      configPath,
    );
  });

  it('getTradejsProjectCwd prefers explicit value over PROJECT_CWD', () => {
    const previousProjectCwd = process.env.PROJECT_CWD;

    try {
      process.env.PROJECT_CWD = '/tmp/from-env';

      expect(getTradejsProjectCwd('/tmp/explicit')).toBe('/tmp/explicit');
      expect(getTradejsProjectCwd()).toBe('/tmp/from-env');
    } finally {
      process.env.PROJECT_CWD = previousProjectCwd;
    }
  });

  it('uses cache and does not re-log for same cwd', async () => {
    const cwd = createTempDir();
    const configPath = path.join(cwd, 'tradejs.config.ts');

    fs.writeFileSync(
      configPath,
      `export default { strategies: ['one'] };`,
      'utf8',
    );

    const first = await loadTradejsConfig(cwd);
    fs.writeFileSync(
      configPath,
      `export default { strategies: ['two'] };`,
      'utf8',
    );
    const second = await loadTradejsConfig(cwd);

    expect(first).toEqual({
      strategies: ['one'],
      indicators: [],
      connectors: [],
    });
    expect(second).toEqual(first);
    expect(loggerLogMock).toHaveBeenCalledTimes(1);
  });

  it('logs warning and returns empty config when config import fails', async () => {
    const cwd = createTempDir();
    const configPath = path.join(cwd, 'tradejs.config.ts');

    fs.writeFileSync(configPath, `throw new Error('broken config');`, 'utf8');

    const config = await loadTradejsConfig(cwd);

    expect(config).toEqual({});
    expect(loggerLogMock).toHaveBeenCalledWith(
      'warn',
      'Failed to load TradeJS config from %s: %s',
      configPath,
      expect.stringContaining('broken config'),
    );
  });

  it('resetTradejsConfigCache clears cache and allows re-read for same cwd', async () => {
    const cwd = createTempDir();
    const configPath = path.join(cwd, 'tradejs.config.ts');

    const first = await loadTradejsConfig(cwd);
    expect(first).toEqual({});

    fs.writeFileSync(
      configPath,
      `export default { strategies: ['first'] };`,
      'utf8',
    );

    const stillCached = await loadTradejsConfig(cwd);
    expect(stillCached).toEqual({});

    resetTradejsConfigCache();
    const afterReset = await loadTradejsConfig(cwd);

    expect(afterReset).toEqual({
      strategies: ['first'],
      indicators: [],
      connectors: [],
    });
    expect(loggerLogMock).toHaveBeenCalledWith(
      'debug',
      'Loaded TradeJS config: %s',
      configPath,
    );
  });
});
