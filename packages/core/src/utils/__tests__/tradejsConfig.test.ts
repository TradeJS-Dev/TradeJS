import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadTradejsConfig,
  resetTradejsConfigCache,
} from '@utils/tradejsConfig';

const loggerLogMock = jest.fn();

jest.mock('@utils/logger', () => ({
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
  strategyPlugins: [' alpha ', '', null, 10],
  indicatorsPlugins: ['beta', '  ', undefined]
};`,
      'utf8',
    );

    const config = await loadTradejsConfig(cwd);

    expect(config).toEqual({
      strategyPlugins: ['alpha', '10'],
      indicatorsPlugins: ['beta'],
    });
    expect(loggerLogMock).toHaveBeenCalledWith(
      'info',
      'Loaded TradeJS config: %s',
      configPath,
    );
  });

  it('uses cache and does not re-log for same cwd', async () => {
    const cwd = createTempDir();
    const configPath = path.join(cwd, 'tradejs.config.ts');

    fs.writeFileSync(
      configPath,
      `export default { strategyPlugins: ['one'] };`,
      'utf8',
    );

    const first = await loadTradejsConfig(cwd);
    fs.writeFileSync(
      configPath,
      `export default { strategyPlugins: ['two'] };`,
      'utf8',
    );
    const second = await loadTradejsConfig(cwd);

    expect(first).toEqual({ strategyPlugins: ['one'], indicatorsPlugins: [] });
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
      `export default { strategyPlugins: ['first'] };`,
      'utf8',
    );

    const stillCached = await loadTradejsConfig(cwd);
    expect(stillCached).toEqual({});

    resetTradejsConfigCache();
    const afterReset = await loadTradejsConfig(cwd);

    expect(afterReset).toEqual({
      strategyPlugins: ['first'],
      indicatorsPlugins: [],
    });
    expect(loggerLogMock).toHaveBeenCalledWith(
      'info',
      'Loaded TradeJS config: %s',
      configPath,
    );
  });
});
