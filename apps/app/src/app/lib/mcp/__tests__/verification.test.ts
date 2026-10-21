import { createHash } from 'node:crypto';
import { parseDeploymentVerification } from '../verification';

describe('Deploy-owned verification', () => {
  const manifestBytes = Buffer.from(
    JSON.stringify({
      projectSha: 'a'.repeat(40),
      packages: { '@tradejs/node': '3.1.29-beta.275' },
    }),
  );
  const hash = (bytes: Buffer) =>
    createHash('sha256').update(bytes).digest('hex');
  const binding = {
    userName: 'root',
    deploymentId: 'production',
    accountId: 'bybit-default',
    deploymentCompositionId: 'dc1:abc',
  };
  const image = 'sha256:' + 'b'.repeat(64);
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      reportType: 'runtime-deployment-verification',
      ok: true,
      health: { status: 'healthy' },
      verification: {
        ok: true,
        strategies: [
          {
            strategyName: 'Test',
            strategyRevision: 'sr1:abc',
            controlState: 'active',
          },
        ],
      },
      ...binding,
      projectSha: 'a'.repeat(40),
      imageDigest: image,
      observedAt: 1000,
      deploymentVerifiedAt: 500,
      runtimePackageManifest: {
        sha256: hash(manifestBytes),
        bytes: manifestBytes.length,
        manifest: JSON.parse(manifestBytes.toString()),
      },
    }),
  );
  const pointer = { bytes: bytes.length, sha256: hash(bytes) };
  it('returns full manifest and reports staleness without resetting soak', () => {
    const exported = parseDeploymentVerification(
      bytes,
      pointer,
      binding,
      manifestBytes,
      image,
      2000,
    );
    expect(hash(Buffer.from(exported.payload.data, 'base64'))).toBe(
      pointer.sha256,
    );

    expect(
      parseDeploymentVerification(
        bytes,
        pointer,
        binding,
        manifestBytes,
        image,
        2000,
      ).fresh,
    ).toBe(true);
    expect(
      parseDeploymentVerification(
        bytes,
        pointer,
        binding,
        manifestBytes,
        image,
        700000,
      ).fresh,
    ).toBe(false);
  });
  it('rejects corruption, another account/composition, manifest and image', () => {
    expect(() =>
      parseDeploymentVerification(
        Buffer.from('corrupt'),
        pointer,
        binding,
        manifestBytes,
        image,
      ),
    ).toThrow(/checksum/);
    expect(() =>
      parseDeploymentVerification(
        bytes,
        pointer,
        { ...binding, accountId: 'other' },
        manifestBytes,
        image,
      ),
    ).toThrow(/binding/);
    expect(() =>
      parseDeploymentVerification(
        bytes,
        pointer,
        binding,
        manifestBytes,
        'sha256:' + 'c'.repeat(64),
      ),
    ).toThrow(/image/);
    expect(() =>
      parseDeploymentVerification(
        bytes,
        pointer,
        binding,
        Buffer.from('{}'),
        image,
      ),
    ).toThrow(/manifest/);
  });
});

/** Reads actual published files, including failed collection state and missing receipts. */
describe('verification filesystem reader', () => {
  it('does not serve a healthy receipt as fresh after the next collection failed', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { readDeploymentVerification } = await import('../verification');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-verification-'));
    const previousDigest = process.env.TRADEJS_PROJECT_IMAGE_DIGEST;
    const digest = 'sha256:' + 'b'.repeat(64);
    process.env.TRADEJS_PROJECT_IMAGE_DIGEST = digest;
    try {
      const binding = {
        userName: 'root',
        deploymentId: 'production',
        accountId: 'account',
        deploymentCompositionId: 'dc1:abc',
      };
      await expect(readDeploymentVerification(root, binding)).rejects.toThrow(
        /not published/,
      );
      const manifest = { projectSha: 'a'.repeat(40), packages: {} };
      const manifestBytes = Buffer.from(JSON.stringify(manifest));
      const hash = (bytes: Buffer) =>
        createHash('sha256').update(bytes).digest('hex');
      await fs.writeFile(
        path.join(root, 'runtime-package-manifest.json'),
        manifestBytes,
      );
      const dir = path.join(
        root,
        'data/runtime-verification/root/production',
        manifest.projectSha,
        'dc1:abc',
      );
      await fs.mkdir(dir, { recursive: true });
      const now = Date.now();
      const bytes = Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          reportType: 'runtime-deployment-verification',
          ok: true,
          health: { status: 'healthy' },
          verification: {
            ok: true,
            strategies: [
              {
                strategyName: 'Test',
                strategyRevision: 'sr1:abc',
                controlState: 'active',
              },
            ],
          },
          ...binding,
          projectSha: manifest.projectSha,
          imageDigest: digest,
          observedAt: now,
          deploymentVerifiedAt: now - 86400000,
          runtimePackageManifest: {
            sha256: hash(manifestBytes),
            bytes: manifestBytes.length,
            manifest,
          },
        }),
      );
      const file = hash(bytes) + '.json';
      await fs.writeFile(path.join(dir, file), bytes);
      await fs.writeFile(
        path.join(dir, 'latest.json'),
        JSON.stringify({ file, sha256: hash(bytes), bytes: bytes.length }),
      );
      expect((await readDeploymentVerification(root, binding)).fresh).toBe(
        true,
      );
      await fs.writeFile(
        path.join(
          root,
          'data/runtime-verification/root/production/latest-attempt.json',
        ),
        JSON.stringify({
          projectSha: manifest.projectSha,
          imageDigest: digest,
          observedAt: now + 1,
          status: 'failed',
        }),
      );
      expect((await readDeploymentVerification(root, binding)).fresh).toBe(
        false,
      );
      await fs.writeFile(path.join(dir, file), 'corrupt');
      await expect(readDeploymentVerification(root, binding)).rejects.toThrow(
        /size mismatch/,
      );
    } finally {
      if (previousDigest === undefined)
        delete process.env.TRADEJS_PROJECT_IMAGE_DIGEST;
      else process.env.TRADEJS_PROJECT_IMAGE_DIGEST = previousDigest;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
