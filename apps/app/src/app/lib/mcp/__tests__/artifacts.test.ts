/** @jest-environment node */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  publishRuntimeEvidenceBundle,
  sealRuntimeFeedbackReplayBundle,
} from '@tradejs/node/diagnostics';
import {
  listMcpArtifacts,
  readMcpArtifactChunk,
  resolveMcpArtifact,
  readMcpDiagnosticReport,
} from '../artifacts';
let mockRoot = '';
let mockAllowed = true;
const mockStore = new Map<string, unknown>();
jest.mock('@tradejs/infra/redis', () => ({
  mcpStorage: {
    get: async (key: string) => mockStore.get(key) ?? null,
    put: async (key: string, value: unknown) => {
      mockStore.set(key, value);
      return true;
    },
  },
}));
jest.mock('@tradejs/node/mcp', () => ({
  mcpProjectRoot: () => mockRoot,
  redactMcpJobLog: (line: string) =>
    jest.requireActual('@tradejs/node/mcp').redactMcpJobLog(line),
  mcpId: (value: string) =>
    require('node:crypto').createHash('sha256').update(value).digest('hex'),
  isMcpRecord: (value: unknown) =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  readMcpDeployments: async () => ({
    deployments: mockAllowed
      ? [{ id: 'production', accountId: 'account' }]
      : [],
  }),
}));
const artifact = {
  reportType: 'runtime-evidence',
  producer: {
    schemaVersion: 1,
    projectSha: 'a'.repeat(40),
    imageDigest: 'sha256:' + 'b'.repeat(64),
    runtimePackageManifest: {
      file: 'runtime-package-manifest.json',
      sha256: 'c'.repeat(64),
    },
  },
  generatedAt: 2000,
  userName: 'alice',
  window: { startTime: 1000, endTime: 2000 },
  runtime: {
    counts: {},
    trades: [],
    signals: [],
    evaluations: [],
    lineageScopes: [],
  },
  deployment: {
    schemaVersion: 2,
    id: 'production',
    deploymentCompositionId: 'dc1:1111111111111111',
    label: 'Production',
    connectorName: 'bybit',
    provider: 'bybit',
    accountId: 'account',
    enabled: true,
    strategies: [
      {
        strategyName: 'DoubleTap',
        strategyRevision: 'sr1:5555555555555555',
        enabled: true,
        controlState: 'active',
        interval: '15',
        universe: 'crypto',
        strategyPackage: '@tradejs/strategy-double-tap',
        strategyPackageVersion: '3.0.2',
        strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.3' },
        runtimePackageVersion: '3.1.14',
        strategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
      },
    ],
  },
};
beforeEach(async () => {
  mockRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tradejs-mcp-artifact-'));
  mockAllowed = true;
  mockStore.clear();
});
afterEach(async () => {
  await fs.rm(mockRoot, { recursive: true, force: true });
});
const publish = (endTime = 2000, lineageKeys: string[] = []) =>
  publishRuntimeEvidenceBundle({
    publishRoot: path.join(mockRoot, 'data/runtime-evidence'),
    deploymentId: 'production',
    userName: 'alice',
    startTime: 1000,
    endTime,
    artifact: {
      ...artifact,
      generatedAt: endTime,
      window: { startTime: 1000, endTime },
    },
    counts: {},
    lineageKeys,
  });
test('catalog exposes only sealed owned evidence and chunks reproduce the advertised checksum', async () => {
  const bundle = await publish();
  expect((await listMcpArtifacts('bob')).items).toHaveLength(0);
  const catalog = await listMcpArtifacts('alice');
  expect(catalog.items).toHaveLength(1);
  const item = catalog.items[0];
  const first = await readMcpArtifactChunk('alice', item.id, 0, 48);
  const rest = await readMcpArtifactChunk('alice', item.id, 48, item.bytes);
  const bytes = Buffer.concat([
    Buffer.from(first.data, 'base64'),
    Buffer.from(rest.data, 'base64'),
  ]);
  expect(bytes.length).toBe(item.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256);
  expect(bytes).toEqual(await fs.readFile(bundle.payloadPath));
  await expect(resolveMcpArtifact('bob', item.id)).rejects.toThrow(
    'Artifact not found',
  );
  mockAllowed = false;
  await expect(resolveMcpArtifact('alice', item.id)).rejects.toThrow(
    'unavailable',
  );
});
test('modified payloads are rejected again after listing', async () => {
  const bundle = await publish();
  const [item] = (await listMcpArtifacts('alice')).items;
  await fs.appendFile(bundle.payloadPath, '\n');
  await expect(resolveMcpArtifact('alice', item.id)).rejects.toThrow(
    'size mismatch',
  );
  expect((await listMcpArtifacts('alice')).items).toHaveLength(0);
});
test('catalog does not embed unbounded manifests in list responses', async () => {
  await publish(
    2000,
    Array.from({ length: 2200 }, (_, index) => `${index}:${'x'.repeat(64)}`),
  );
  const catalog = await listMcpArtifacts('alice');
  expect(catalog.items).toHaveLength(1);
  expect(catalog.items[0]).not.toHaveProperty('manifest');
  expect(Buffer.byteLength(JSON.stringify(catalog))).toBeLessThan(128 * 1024);
});
test('catalog pages compact verified entries and applies filters before pagination', async () => {
  await publish(2000);
  await publish(3000);
  const first = await listMcpArtifacts('alice', {
    deploymentId: 'production',
    limit: 1,
  });
  expect(first.items).toHaveLength(1);
  expect(first.nextOffset).toBe(1);
  expect(first.scanTruncated).toBe(false);
  const second = await listMcpArtifacts('alice', {
    offset: first.nextOffset!,
    limit: 1,
  });
  expect(second.items).toHaveLength(1);
  expect(second.items[0].id).not.toBe(first.items[0].id);
  expect(second.nextOffset).toBeNull();
  expect(
    (await listMcpArtifacts('alice', { deploymentId: 'other' })).items,
  ).toEqual([]);
  expect(
    (await listMcpArtifacts('alice', { kind: 'runtime-feedback-replay' }))
      .items,
  ).toEqual([]);
  await expect(listMcpArtifacts('alice', { limit: 101 })).rejects.toThrow(
    'pagination',
  );
  await expect(listMcpArtifacts('alice', { offset: -1 })).rejects.toThrow(
    'pagination',
  );
});
test('payload symlinks cannot escape the data root even with a valid hash', async () => {
  const bundle = await publish();
  const outside = path.join(mockRoot, 'outside.json');
  await fs.copyFile(bundle.payloadPath, outside);
  await fs.unlink(bundle.payloadPath);
  await fs.symlink(outside, bundle.payloadPath);
  expect((await listMcpArtifacts('alice')).items).toHaveLength(0);
});

test('window filtering precedes pagination and newest windows sort first', async () => {
  await publish(2000);
  await publish(3000);
  const page = await listMcpArtifacts('alice', {
    startTime: 2000,
    endTime: 3000,
    limit: 1,
  });
  expect(page.items).toHaveLength(1);
  expect(page.items[0].window.endTime).toBe(3000);
  expect(page.nextOffset).toBeNull();
  expect(
    (await listMcpArtifacts('alice')).items.map((row) => row.window.endTime),
  ).toEqual([3000, 2000]);
});

test('bundle metadata downloads reproduce original bytes and independent checksums', async () => {
  const bundle = await publish();
  const [item] = (await listMcpArtifacts('alice')).items;
  const report = await readMcpDiagnosticReport('alice', item.id);
  for (const file of ['manifest.json', '.complete'] as const) {
    const descriptor = report.files.find((row) => row.file === file)!;
    expect(descriptor.available).toBe(true);
    const chunk = await readMcpArtifactChunk('alice', item.id, 0, 48000, file);
    const bytes = Buffer.from(chunk.data, 'base64');
    expect(bytes).toEqual(await fs.readFile(path.join(bundle.bundleDir, file)));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(chunk.sha256);
  }
  await expect(readMcpArtifactChunk('alice', item.id, -1, 48)).rejects.toThrow(
    'range',
  );
  await expect(
    readMcpArtifactChunk('alice', item.id, item.bytes + 1, 48),
  ).rejects.toThrow('offset');
  await expect(
    readMcpArtifactChunk('alice', item.id, 0, 48, '../../outside' as never),
  ).rejects.toThrow('file');
});

test.each(['cache-only replay completed\n', 'API_KEY=secret-value\n'])(
  'replay bundles export complete safe logs or explicitly withhold sensitive bytes',
  async (log) => {
    const evidence = await publish();
    const bundleDir = path.join(mockRoot, 'data/runtime-feedback/run-1');
    await fs.mkdir(bundleDir, { recursive: true });
    await fs.writeFile(
      path.join(bundleDir, 'replay-runtime-evidence.json'),
      JSON.stringify({
        reportType: 'replay-runtime-evidence',
        userName: 'alice',
        window: artifact.window,
        deployment: artifact.deployment,
        replay: { cycleCount: 1 },
      }),
    );
    await fs.writeFile(path.join(bundleDir, 'replay.log'), log);
    await sealRuntimeFeedbackReplayBundle({
      bundleDir,
      runId: 'run-1',
      runtimeEvidenceBundle: evidence,
    });
    const [item] = (
      await listMcpArtifacts('alice', { kind: 'runtime-feedback-replay' })
    ).items;
    const report = await readMcpDiagnosticReport('alice', item.id);
    const safe = !log.includes('API_KEY');
    expect(
      report.files.find((row) => row.file === 'replay.log')?.available,
    ).toBe(safe);
    if (safe) {
      const chunk = await readMcpArtifactChunk(
        'alice',
        item.id,
        0,
        48000,
        'replay.log',
      );
      expect(Buffer.from(chunk.data, 'base64').toString()).toBe(log);
      expect(chunk.sha256).toBe(createHash('sha256').update(log).digest('hex'));
    } else {
      await expect(
        readMcpArtifactChunk('alice', item.id, 0, 48000, 'replay.log'),
      ).rejects.toThrow('redaction');
    }
  },
);
