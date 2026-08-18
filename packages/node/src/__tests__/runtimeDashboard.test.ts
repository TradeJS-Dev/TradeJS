import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mockLoadRuntimeStrategyConfigs = jest.fn();
const mockListRuntimeDeployments = jest.fn();
const mockListTradingAccounts = jest.fn();
const mockResolveTradingAccount = jest.fn();
const mockGetAvailableStrategyNames = jest.fn();
const mockGetConnectorCreatorByProvider = jest.fn();
const mockGetData = jest.fn();
const mockGetHashJsonValues = jest.fn();
const mockGetKeys = jest.fn();
const mockSyncRuntimeTrades = jest.fn();

jest.mock('@tradejs/infra/runtimeStrategyConfigs', () => ({
  loadRuntimeStrategyConfigs: (...args: unknown[]) =>
    mockLoadRuntimeStrategyConfigs(...args),
}));

jest.mock('@tradejs/infra/runtimeDeployments', () => ({
  listRuntimeDeployments: (...args: unknown[]) =>
    mockListRuntimeDeployments(...args),
}));

jest.mock('@tradejs/infra/tradingAccounts', () => ({
  listTradingAccounts: (...args: unknown[]) => mockListTradingAccounts(...args),
  resolveTradingAccount: (...args: unknown[]) =>
    mockResolveTradingAccount(...args),
}));

jest.mock('../strategies', () => ({
  getAvailableStrategyNames: (...args: unknown[]) =>
    mockGetAvailableStrategyNames(...args),
}));

jest.mock('../connectorsRegistry', () => ({
  getConnectorCreatorByProvider: (...args: unknown[]) =>
    mockGetConnectorCreatorByProvider(...args),
}));

jest.mock('@tradejs/infra/redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  getHashJsonValues: (...args: unknown[]) => mockGetHashJsonValues(...args),
  getKeys: (...args: unknown[]) => mockGetKeys(...args),
  redisKeys: {
    runtimeTradeBucket: (userName: string, dayKey: string) =>
      `runtime-trades:${userName}:${dayKey}`,
    runtimeTrades: (userName: string) => `runtime-trades:${userName}`,
    runtimeActiveTrades: (userName: string) =>
      `runtime-active-trades:${userName}`,
    runtimeLineageScopeBucket: (userName: string, dayKey: string) =>
      `runtime-lineage:${userName}:${dayKey}`,
  },
}));

jest.mock('../runtimeTradeSync', () => ({
  isRuntimeTradeInConnectorScope: jest.fn(() => true),
  syncRuntimeTrades: (...args: unknown[]) => mockSyncRuntimeTrades(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => args,
  },
}));

import { loadRuntimeDashboard } from '../runtimeDashboard';
import { canonicalStrategyEvidenceJson } from '../strategyEvidenceTimeline';
import { strategyLogicConfigFingerprint } from '@tradejs/infra/strategyReleaseEvidence';

describe('runtime dashboard', () => {
  const temporaryRoots: string[] = [];
  const originalMarkerDir = process.env.STRATEGY_RELEASE_MARKER_DIR;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STRATEGY_RELEASE_MARKER_DIR;
    mockLoadRuntimeStrategyConfigs.mockResolvedValue([
      {
        key: 'users:root:strategies:TrendLine:config',
        strategyName: 'TrendLine',
        configId: 'config',
        strategyConfig: { INTERVAL: '15', ENABLE: true },
      },
    ]);
    mockListRuntimeDeployments.mockResolvedValue([]);
    mockListTradingAccounts.mockResolvedValue([
      { id: 'crypto-main', label: 'Crypto main' },
    ]);
    mockResolveTradingAccount.mockResolvedValue({ id: 'crypto-main' });
    mockGetAvailableStrategyNames.mockResolvedValue([]);
    mockGetData.mockResolvedValue(null);
    mockGetHashJsonValues.mockResolvedValue([]);
    mockGetKeys.mockResolvedValue([]);
    mockSyncRuntimeTrades.mockImplementation(async ({ trades }) => trades);
    mockGetConnectorCreatorByProvider.mockResolvedValue(
      jest.fn(async () => ({
        universe: 'crypto',
        accountId: 'crypto-main',
      })),
    );
  });

  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true })),
    );
  });

  afterAll(() => {
    if (originalMarkerDir === undefined) {
      delete process.env.STRATEGY_RELEASE_MARKER_DIR;
    } else {
      process.env.STRATEGY_RELEASE_MARKER_DIR = originalMarkerDir;
    }
  });

  it('builds the complete dashboard read model through one interface', async () => {
    const response = await loadRuntimeDashboard({
      userName: 'root',
      provider: ' bybit ',
      hours: 2,
      now: 1_700_000_000_000,
      projectRoot: '/project',
    });

    expect(mockGetConnectorCreatorByProvider).toHaveBeenCalledWith(
      'bybit',
      '/project',
    );
    expect(response).toMatchObject({
      provider: 'bybit',
      hours: 6,
      generatedAt: 1_700_000_000_000,
      dataSources: {
        localTrades: 0,
        exchangeFallbackTrades: 0,
        exchangeErrors: [],
      },
      strategies: [
        {
          strategyName: 'TrendLine',
          configId: 'config',
          interval: '15',
          universe: 'crypto',
          accountId: 'crypto-main',
          accountLabel: 'Crypto main',
          connected: true,
          enabled: true,
          config: { INTERVAL: '15', ENABLE: true },
          symbols: [],
          orders: [],
          evidenceTimeline: {
            status: 'missing',
            observedFrom: null,
            markers: [],
          },
        },
      ],
    });
  });

  it('keeps deployment strategies without embedded config readable', async () => {
    mockListRuntimeDeployments.mockResolvedValue([
      {
        id: 'doubletap-forward',
        label: 'Crypto forward runtime',
        connectorName: 'bybit',
        provider: 'bybit',
        accountId: 'crypto-main',
        universe: 'crypto',
        interval: '15',
        enabled: true,
        strategies: [
          {
            strategyName: 'DoubleTap',
            policyProfileId: 'default',
          },
        ],
      },
    ]);

    const response = await loadRuntimeDashboard({
      userName: 'root',
      provider: 'bybit',
      hours: 6,
      now: 1_700_000_000_000,
      projectRoot: '/project',
    });

    expect(response.strategies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          strategyName: 'DoubleTap',
          configId: 'deployment-doubletap-forward',
          config: null,
          evidenceTimeline: {
            status: 'missing',
            observedFrom: null,
            markers: [],
          },
        }),
      ]),
    );
  });

  it('fails before reading sources when the connector is unavailable', async () => {
    mockGetConnectorCreatorByProvider.mockResolvedValue(null);

    await expect(
      loadRuntimeDashboard({ userName: 'root', provider: 'missing' }),
    ).rejects.toThrow('No connector available for provider "missing"');
    expect(mockLoadRuntimeStrategyConfigs).not.toHaveBeenCalled();
  });

  it('does not attach immutable evidence without exact runtime lineage', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'runtime-dashboard-evidence-'),
    );
    temporaryRoots.push(projectRoot);
    const createdAt = 1_699_999_500_000;
    const payload = {
      strategy: 'TrendLine',
      createdAt,
      markers: [
        {
          id: 'release-1:gate',
          type: 'G',
          timestamp: createdAt,
          label: 'Composition frozen',
          summary: 'TrendLine composition',
          artifactId: 'release-1',
          artifactSha256: 'a'.repeat(64),
          configFingerprint: strategyLogicConfigFingerprint({
            INTERVAL: '15',
            ENABLE: false,
            ACCOUNT_ID: 'another-machine',
            MAX_LOSS_VALUE: 10,
          }),
        },
      ],
      sourceArtifacts: [
        {
          artifactId: 'source-1',
          sha256: 'b'.repeat(64),
          path: '/private/evidence/source.json',
        },
      ],
    };
    const payloadSha256 = createHash('sha256')
      .update(canonicalStrategyEvidenceJson(payload))
      .digest('hex');
    const artifactId = `TrendLine_20231114T220500Z_${payloadSha256.slice(0, 16)}`;
    const markerDir = path.join(
      projectRoot,
      'data/strategy-release/markers/TrendLine',
    );
    await fs.mkdir(markerDir, { recursive: true });
    await fs.writeFile(
      path.join(markerDir, `${artifactId}.json`),
      JSON.stringify({
        schema: 'tradejs-strategy-evidence-markers/v1',
        artifactId,
        payloadSha256,
        payload,
      }),
    );

    const response = await loadRuntimeDashboard({
      userName: 'root',
      provider: 'bybit',
      hours: 6,
      now: 1_700_000_000_000,
      projectRoot,
    });

    expect(response.strategies[0]?.evidenceTimeline).toEqual({
      status: 'missing',
      observedFrom: null,
      markers: [],
    });
    expect(JSON.stringify(response)).not.toContain('/private/evidence');
    expect(
      mockGetHashJsonValues.mock.calls.some(([key]) =>
        String(key).startsWith('runtime-lineage:'),
      ),
    ).toBe(false);
  });
});
