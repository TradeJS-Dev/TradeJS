/** @jest-environment node */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publishRuntimeEvidenceBundle } from '@tradejs/node/diagnostics';
import {
  listMcpArtifacts,
  readMcpArtifactChunk,
  resolveMcpArtifact,
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
const publish = () =>
  publishRuntimeEvidenceBundle({
    publishRoot: path.join(mockRoot, 'data/runtime-evidence'),
    deploymentId: 'production',
    userName: 'alice',
    startTime: 1000,
    endTime: 2000,
    artifact,
    counts: {},
    lineageKeys: [],
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
test('payload symlinks cannot escape the data root even with a valid hash', async () => {
  const bundle = await publish();
  const outside = path.join(mockRoot, 'outside.json');
  await fs.copyFile(bundle.payloadPath, outside);
  await fs.unlink(bundle.payloadPath);
  await fs.symlink(outside, bundle.payloadPath);
  expect((await listMcpArtifacts('alice')).items).toHaveLength(0);
});
