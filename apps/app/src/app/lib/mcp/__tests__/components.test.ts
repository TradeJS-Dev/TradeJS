/** @jest-environment node */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readRuntimeComponents } from '../components';

describe('Deploy component snapshot reader', () => {
  let root: string;
  let directory: string;
  const now = 1800000000000;
  const projectSha = 'a'.repeat(40);
  const imageDigest = 'sha256:' + 'b'.repeat(64);
  const previousDigest = process.env.TRADEJS_PROJECT_IMAGE_DIGEST;
  const report = () => ({
    schemaVersion: 1,
    reportType: 'runtime-components',
    userName: 'root',
    projectSha,
    deploySourceSha: 'd'.repeat(40),
    observedAt: now,
    ok: true,
    components: [
      'app',
      'agent',
      'ml-infer',
      'site',
      'docs',
      'certbot',
      'certbot-cron',
    ].map((name) => ({
      name,
      declaredImage: `ghcr.io/tradejs-dev/tradejs-${name === 'app' ? 'project-app' : name === 'certbot-cron' ? 'certbot' : name}:${projectSha}`,
      sourceSha: projectSha,
      containerId: 'c'.repeat(64),
      imageId: 'sha256:' + 'e'.repeat(64),
      imageDigest,
      state: 'running',
      running: true,
      health: null,
      startedAt: '2026-11-25T00:00:00Z',
      restartCount: 0,
      exitCode: 0,
      matchesRelease: true,
      ok: true,
    })),
  });
  const publish = async (value = report()) => {
    const bytes = Buffer.from(JSON.stringify(value));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(
      path.join(directory, 'latest.json'),
      JSON.stringify({
        bytes: bytes.length,
        sha256,
        data: bytes.toString('base64'),
      }),
    );
    await writeFile(
      path.join(directory, 'latest-attempt.json'),
      JSON.stringify({
        observedAt: value.observedAt,
        status: 'succeeded',
        sha256,
      }),
    );
    return { bytes, sha256 };
  };
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'mcp-components-'));
    directory = path.join(root, 'data/runtime-components/root');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(root, 'runtime-package-manifest.json'),
      JSON.stringify({ projectSha }),
    );
    process.env.TRADEJS_PROJECT_IMAGE_DIGEST = imageDigest;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    if (previousDigest === undefined)
      delete process.env.TRADEJS_PROJECT_IMAGE_DIGEST;
    else process.env.TRADEJS_PROJECT_IMAGE_DIGEST = previousDigest;
  });
  it('exports original verified bytes and daily freshness without a soak timestamp', async () => {
    const { bytes, sha256 } = await publish();
    const result = await readRuntimeComponents(root, 'root', now + 3600000);
    expect(Buffer.from(result.payload.data, 'base64')).toEqual(bytes);
    expect(result.sha256).toBe(sha256);
    expect(result.fresh).toBe(true);
    expect(result.report).not.toHaveProperty('deploymentVerifiedAt');
    expect(
      (await readRuntimeComponents(root, 'root', now + 26 * 3600000)).fresh,
    ).toBe(false);
  });
  it.each(['failed', 'running'])(
    'does not call an older success fresh after a %s capture',
    async (status) => {
      await publish();
      await writeFile(
        path.join(directory, 'latest-attempt.json'),
        JSON.stringify({ status, observedAt: now + 1 }),
      );
      const result = await readRuntimeComponents(root, 'root', now + 2);
      expect(result.fresh).toBe(false);
      expect(result.collection.status).toBe(status);
    },
  );
  it('returns known missing/mismatched components as failed evidence', async () => {
    const value = report();
    value.ok = false;
    value.components[1].ok = false;
    value.components[1].matchesRelease = false;
    await publish(value);
    expect((await readRuntimeComponents(root, 'root', now)).report.ok).toBe(
      false,
    );
  });
  it('rejects another owner, old Project, wrong image or corrupt bytes', async () => {
    const original = await publish();
    await expect(readRuntimeComponents(root, 'alice', now)).rejects.toThrow(
      /owner/,
    );
    await writeFile(
      path.join(root, 'runtime-package-manifest.json'),
      JSON.stringify({ projectSha: 'f'.repeat(40) }),
    );
    await expect(readRuntimeComponents(root, 'root', now)).rejects.toThrow(
      /binding/,
    );
    await writeFile(
      path.join(root, 'runtime-package-manifest.json'),
      JSON.stringify({ projectSha }),
    );
    process.env.TRADEJS_PROJECT_IMAGE_DIGEST = 'sha256:' + 'f'.repeat(64);
    await expect(readRuntimeComponents(root, 'root', now)).rejects.toThrow(
      /binding/,
    );
    process.env.TRADEJS_PROJECT_IMAGE_DIGEST = imageDigest;
    await writeFile(
      path.join(directory, 'latest.json'),
      JSON.stringify({
        bytes: original.bytes.length,
        sha256: original.sha256,
        data: Buffer.from('{}').toString('base64'),
      }),
    );
    await expect(readRuntimeComponents(root, 'root', now)).rejects.toThrow(
      /checksum/,
    );
  });
  it('rejects duplicate components, invalid results, future timestamps and unexpected fields', async () => {
    const duplicate = report();
    duplicate.components[1] = duplicate.components[0];
    const invalid = report();
    invalid.components[1].matchesRelease = false;
    const future = report();
    future.observedAt += 60000;
    for (const value of [
      duplicate,
      invalid,
      future,
      { ...report(), environment: { SECRET: 'must not be exported' } },
    ]) {
      await publish(value);
      await expect(readRuntimeComponents(root, 'root', now)).rejects.toThrow();
    }
  });
  it('rejects missing receipts, oversized files and paths outside the snapshot directory', async () => {
    await expect(readRuntimeComponents(root, 'root', now)).rejects.toThrow();
    await writeFile(path.join(directory, 'latest.json'), 'x'.repeat(70001));
    await expect(readRuntimeComponents(root, 'root', now)).rejects.toThrow(
      /file/,
    );
    await rm(path.join(directory, 'latest.json'));
    await writeFile(path.join(root, 'outside.json'), '{}');
    await symlink(
      path.join(root, 'outside.json'),
      path.join(directory, 'latest.json'),
    );
    await expect(readRuntimeComponents(root, 'root', now)).rejects.toThrow(
      /file/,
    );
  });
});
