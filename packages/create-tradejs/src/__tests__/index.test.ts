import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findAvailablePort,
  parseArgs,
  scaffoldProject,
  updateProjectSkills,
} from '../index';

const sha256 = (contents: string) =>
  createHash('sha256').update(contents).digest('hex');

describe('create-tradejs', () => {
  it('uses a one-command default project', () => {
    expect(parseArgs([])).toMatchObject({
      targetDir: 'tradejs-project',
      install: true,
      infra: true,
      start: true,
      open: true,
      port: 3000,
      updateSkills: false,
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
      updateSkills: false,
    });
  });

  it('supports skill-only updates for the current directory', () => {
    expect(parseArgs(['--update-skills'])).toEqual({
      targetDir: '.',
      install: false,
      infra: false,
      start: false,
      open: false,
      port: 3000,
      updateSkills: true,
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
      const installedSkills = [
        'ai-train-local-research',
        'backtest-config-redis',
        'runtime-parity-mismatch-analysis',
        'save-strategy-config-from-backtest',
        'strategy-backtest-research',
        'strategy-candidate-report',
        'strategy-candidate-compare',
        'strategy-improvement-plan',
        'strategy-improvement-research',
        'strategy-period-revalidate',
        'strategy-forward-start',
        'strategy-forward-status',
        'strategy-risk-scale',
        'strategy-release',
      ];
      for (const skill of installedSkills) {
        expect(
          existsSync(path.join(target, '.codex', 'skills', skill, 'SKILL.md')),
        ).toBe(true);
      }
      const skillManifest = JSON.parse(
        readFileSync(
          path.join(target, '.codex', 'tradejs-skill-bundle.json'),
          'utf8',
        ),
      );
      expect(skillManifest).toMatchObject({
        schema: 'tradejs-skill-bundle/v1',
        source: 'TradeJS-Dev/TradeJS:.codex/skills',
        skills: installedSkills,
      });
      for (const [relativePath, expectedSha256] of Object.entries<string>(
        skillManifest.files,
      )) {
        expect(
          sha256(readFileSync(path.join(target, relativePath), 'utf8')),
        ).toBe(expectedSha256);
      }
      expect(
        readFileSync(
          path.join(
            target,
            '.codex',
            'skills',
            'strategy-forward-start',
            'SKILL.md',
          ),
          'utf8',
        ),
      ).toContain('MAX_LOSS_VALUE=1');
      expect(existsSync(path.join(target, '.tradejs', 'credentials.txt'))).toBe(
        false,
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('updates the managed bundle without touching custom skills', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'tradejs-skills-'));
    const customSkill = path.join(
      target,
      '.codex',
      'skills',
      'my-custom-skill',
      'SKILL.md',
    );
    mkdirSync(path.dirname(customSkill), { recursive: true });
    writeFileSync(customSkill, '# Custom\n', 'utf8');

    try {
      const manifest = updateProjectSkills(target);
      expect(manifest.schema).toBe('tradejs-skill-bundle/v1');
      expect(readFileSync(customSkill, 'utf8')).toBe('# Custom\n');
      expect(
        existsSync(
          path.join(
            target,
            '.codex',
            'skills',
            'strategy-candidate-report',
            'SKILL.md',
          ),
        ),
      ).toBe(true);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('adopts an existing official skill when it first becomes bundle-managed', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'tradejs-skills-'));
    const officialSkill = path.join(
      target,
      '.codex',
      'skills',
      'ai-train-local-research',
      'SKILL.md',
    );
    mkdirSync(path.dirname(officialSkill), { recursive: true });
    writeFileSync(officialSkill, '# Legacy project snapshot\n', 'utf8');

    try {
      const manifest = updateProjectSkills(target);
      expect(manifest.skills).toContain('ai-train-local-research');
      expect(readFileSync(officialSkill, 'utf8')).toContain(
        'name: ai-train-local-research',
      );
      expect(readFileSync(officialSkill, 'utf8')).not.toContain(
        'Legacy project snapshot',
      );
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite a locally modified managed skill', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'tradejs-skills-'));

    try {
      updateProjectSkills(target);
      const managedSkill = path.join(
        target,
        '.codex',
        'skills',
        'strategy-candidate-report',
        'SKILL.md',
      );
      writeFileSync(managedSkill, '# Locally modified\n', 'utf8');
      expect(() => updateProjectSkills(target)).toThrow(
        'Refusing to overwrite a modified skill',
      );
      expect(readFileSync(managedSkill, 'utf8')).toBe('# Locally modified\n');
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
