import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findAvailablePort, parseArgs, scaffoldProject } from '../index';

describe('create-tradejs', () => {
  it('uses a one-command default project', () => {
    expect(parseArgs([])).toMatchObject({
      targetDir: 'tradejs-project',
      install: true,
      infra: true,
      start: true,
      open: true,
      port: 3000,
    });
  });

  it('supports scaffold-only mode', () => {
    expect(parseArgs(['demo', '--no-install', '--port', '3100'])).toEqual({
      targetDir: 'demo',
      install: false,
      infra: false,
      start: false,
      open: true,
      port: 3100,
    });
  });

  it('skips ports already occupied on IPv4', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '0.0.0.0', () => resolve()),
    );

    try {
      const address = server.address() as AddressInfo;
      await expect(findAvailablePort(address.port)).resolves.not.toBe(
        address.port,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('writes an external npm project', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'create-tradejs-'));
    const target = path.join(parent, 'my-project');

    try {
      scaffoldProject(target, 3210, {
        postgres: 5433,
        redis: 6380,
        redisInsight: 5541,
      });
      const manifest = JSON.parse(
        readFileSync(path.join(target, 'package.json'), 'utf8'),
      );

      expect(manifest.name).toBe('my-project');
      expect(manifest.dependencies).toMatchObject({
        '@tradejs/app': 'latest',
        '@tradejs/base': 'latest',
        '@tradejs/cli': 'latest',
        '@tradejs/core': 'latest',
      });
      expect(manifest.scripts.backtest).toBe('tradejs backtest');
      expect(
        readFileSync(path.join(target, 'tradejs.config.ts'), 'utf8'),
      ).toContain('defineConfig(basePreset)');
      expect(readFileSync(path.join(target, '.env'), 'utf8')).toContain(
        'NEXTAUTH_URL=http://localhost:3210',
      );
      expect(readFileSync(path.join(target, '.env'), 'utf8')).toContain(
        'REDIS_PORT=6380',
      );
      expect(readFileSync(path.join(target, 'README.md'), 'utf8')).toContain(
        'create the local root password',
      );
      expect(existsSync(path.join(target, '.tradejs', 'credentials.txt'))).toBe(
        false,
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
