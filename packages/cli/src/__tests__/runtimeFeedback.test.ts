import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publishRuntimeEvidenceBundle } from '../lib/runtimeEvidenceArtifacts';
import {
  RUNTIME_FEEDBACK_LOG_FILE,
  RUNTIME_FEEDBACK_REPLAY_FILE,
  sealRuntimeFeedbackReplayBundle,
  verifyRuntimeFeedbackReplayBundle,
  verifyRuntimeFeedbackReplaySource,
} from '../lib/runtimeFeedbackArtifacts';
import {
  assertRuntimeFeedbackReplaySafety,
  buildRuntimeFeedbackReplayCommands,
} from '../lib/runtimeFeedbackReplay';
import {
  buildRuntimeFeedbackTelegramMessage,
  notifyRuntimeFeedbackBundle,
} from '../lib/runtimeFeedbackNotification';
import { syncRuntimeFeedbackReplayBundles } from '../lib/runtimeFeedbackSync';
import { resolveRuntimeEvidenceProducer } from '../lib/runtimeEvidenceProducer';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const producer = {
  schemaVersion: 1 as const,
  projectSha: 'a'.repeat(40),
  imageDigest: `sha256:${'b'.repeat(64)}`,
  runtimePackageManifest: {
    file: 'runtime-package-manifest.json' as const,
    sha256: 'c'.repeat(64),
  },
};

const deployment = {
  schemaVersion: 2,
  id: 'production',
  deploymentCompositionId: 'dc1:1111111111111111',
  label: 'Production',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  tickers: ['BTCUSDT'],
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
      strategyDependencyVersions: {
        '@tradejs/strategy-kit': '3.0.3',
      },
      runtimePackageVersion: '3.1.21',
      strategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
    },
  ],
};

describe('production runtime feedback replay', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-feedback-'));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  const createRuntimeEvidence = async () => {
    const startTime = Date.UTC(2026, 7, 22, 18);
    const endTime = Date.UTC(2026, 7, 23, 18);
    const artifact = {
      reportType: 'runtime-evidence',
      generatedAt: endTime,
      producer,
      userName: 'root',
      window: { startTime, endTime },
      deployment,
      runtime: {
        counts: { trades: 1, signals: 1, evaluations: 1 },
        trades: [],
        signals: [],
        evaluations: [],
        lineageScopes: [],
      },
    };
    return publishRuntimeEvidenceBundle({
      publishRoot: path.join(rootDir, 'evidence'),
      deploymentId: 'production',
      userName: 'root',
      startTime,
      endTime,
      artifact,
      counts: { trades: 1, signals: 1, evaluations: 1 },
      lineageKeys: [],
    });
  };

  const createFeedback = async () => {
    const evidence = await createRuntimeEvidence();
    const bundleDir = path.join(rootDir, 'feedback-server', 'run-1');
    await fs.mkdir(bundleDir, { recursive: true });
    await Promise.all([
      fs.writeFile(
        path.join(bundleDir, RUNTIME_FEEDBACK_REPLAY_FILE),
        `${JSON.stringify(
          {
            reportType: 'replay-runtime-evidence',
            generatedAt: Date.now(),
            userName: 'root',
            window: evidence.manifest.window,
            deployment,
            replay: {
              cycleCount: 96,
              signalsCount: 3,
              runtimeComparison: {
                counts: { matched: 2, runtimeOnly: 0, backtestOnly: 0 },
                rows: [
                  {
                    strategyName: 'DoubleTap',
                    runtimeTrades: 2,
                    backtestEntries: 2,
                    matched: 2,
                    orderFailed: 0,
                    runtimeOnly: 0,
                    backtestOnly: 0,
                  },
                ],
                lineage: {
                  replayScopes: 100,
                  comparableScopes: 100,
                  excludedRuntimeTrades: 1,
                },
              },
            },
            runtime: {
              counts: { trades: 3, signals: 5, evaluations: 5 },
            },
          },
          null,
          2,
        )}\n`,
      ),
      fs.writeFile(
        path.join(bundleDir, RUNTIME_FEEDBACK_LOG_FILE),
        'cache-only replay completed\n',
      ),
    ]);
    const feedback = await sealRuntimeFeedbackReplayBundle({
      bundleDir,
      runId: 'daily-1',
      runtimeEvidenceBundle: evidence,
    });
    return { evidence, feedback };
  };

  it('resolves the producer identity from the image package manifest', async () => {
    const manifest = '{"schema":"tradejs-runtime-package-manifest/v1"}\n';
    await fs.writeFile(
      path.join(rootDir, 'runtime-package-manifest.json'),
      manifest,
    );
    const previousSha = process.env.TRADEJS_PROJECT_SHA;
    const previousDigest = process.env.TRADEJS_PROJECT_IMAGE_DIGEST;
    process.env.TRADEJS_PROJECT_SHA = producer.projectSha;
    process.env.TRADEJS_PROJECT_IMAGE_DIGEST = producer.imageDigest;
    try {
      await expect(
        resolveRuntimeEvidenceProducer({
          projectRoot: rootDir,
          required: true,
        }),
      ).resolves.toEqual({
        ...producer,
        runtimePackageManifest: {
          file: 'runtime-package-manifest.json',
          sha256: sha256(manifest),
        },
      });
    } finally {
      if (previousSha == null) delete process.env.TRADEJS_PROJECT_SHA;
      else process.env.TRADEJS_PROJECT_SHA = previousSha;
      if (previousDigest == null)
        delete process.env.TRADEJS_PROJECT_IMAGE_DIGEST;
      else process.env.TRADEJS_PROJECT_IMAGE_DIGEST = previousDigest;
    }
  });

  it('seals, verifies, syncs, and source-binds a replay bundle', async () => {
    const { evidence, feedback } = await createFeedback();
    expect(feedback.manifest.producer).toEqual(producer);
    expect(feedback.manifest.safety).toEqual({
      cacheOnly: true,
      externalOrderPlacement: false,
      redis: 'isolated',
      timescale: 'read_only',
    });
    expect(feedback.manifest.cycleCount).toBe(96);

    const feedbackRoot = path.join(rootDir, 'feedback-local');
    const synced = await syncRuntimeFeedbackReplayBundles({
      source: path.join(rootDir, 'feedback-server'),
      feedbackRoot,
      deploymentId: 'production',
      runRsync: async (args) => {
        const destination = args.at(-1)!.replace(/\/$/, '');
        await fs.cp(feedback.bundleDir, path.join(destination, 'run-1'), {
          recursive: true,
        });
        return {};
      },
    });
    expect(synced.received).toHaveLength(1);
    await expect(
      verifyRuntimeFeedbackReplaySource({
        bundleDir: synced.received[0].bundleDir,
        runtimeEvidenceBundleDir: evidence.bundleDir,
      }),
    ).resolves.toMatchObject({
      feedback: {
        manifest: { artifactId: feedback.manifest.artifactId },
      },
    });
  });

  it('rejects a replay payload changed after sealing', async () => {
    const { feedback } = await createFeedback();
    await fs.appendFile(feedback.replayEvidencePath, 'tampered');
    await expect(
      verifyRuntimeFeedbackReplayBundle(feedback.bundleDir),
    ).rejects.toThrow(/size mismatch|checksum mismatch/);
  });

  it('builds and sends parity from the verified runtime feedback bundle', async () => {
    const { feedback } = await createFeedback();
    const messages: string[] = [];

    await expect(
      notifyRuntimeFeedbackBundle({
        bundleDir: feedback.bundleDir,
        send: async (message) => {
          messages.push(message);
          return 1;
        },
      }),
    ).resolves.toMatchObject({
      artifactId: feedback.manifest.artifactId,
      userName: 'root',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Source: <b>verified runtime feedback</b>');
    expect(messages[0]).toContain('Runtime evidence: trades=<b>3</b>');
    expect(messages[0]).toContain(
      'Comparable entries: runtime=<b>2</b> / backtest=<b>2</b>',
    );
    expect(messages[0]).toContain('Matched: <b>2</b>');
    expect(messages[0]).toContain('Lineage scopes: <b>100 / 100</b>');
    expect(messages[0]).not.toContain('Targets:');
    expect(messages[0]).not.toContain('Replay errors');
  });

  it('rejects an unsealed replay payload before notification', async () => {
    const { feedback } = await createFeedback();
    await fs.appendFile(feedback.replayEvidencePath, 'tampered');

    await expect(
      notifyRuntimeFeedbackBundle({
        bundleDir: feedback.bundleDir,
        send: async () => 1,
      }),
    ).rejects.toThrow(/size mismatch|checksum mismatch/);
  });

  it('reports strategy mismatches from the canonical comparison rows', () => {
    const message = buildRuntimeFeedbackTelegramMessage({
      reportType: 'replay-runtime-evidence',
      window: { startTime: 1_000, endTime: 2_000 },
      deployment: { connectorName: 'bybit', id: 'production' },
      replay: {
        runtimeComparison: {
          counts: { matched: 0, runtimeOnly: 1, backtestOnly: 0 },
          rows: [
            {
              strategyName: 'Flag<script>',
              runtimeTrades: 1,
              backtestEntries: 0,
              matched: 0,
              orderFailed: 0,
              runtimeOnly: 1,
              backtestOnly: 0,
            },
          ],
          lineage: { replayScopes: 1, comparableScopes: 1 },
        },
      },
      runtime: { counts: { trades: 1, signals: 1, evaluations: 1 } },
    });

    expect(message).toContain('Flag&lt;script&gt;: runtimeOnly=1');
    expect(message).not.toContain('Flag<script>');
  });

  it('does not report a clean result when comparison data is missing', () => {
    expect(() =>
      buildRuntimeFeedbackTelegramMessage({
        reportType: 'replay-runtime-evidence',
        window: { startTime: 1_000, endTime: 2_000 },
        deployment: { connectorName: 'bybit', id: 'production' },
        replay: {},
        runtime: { counts: { trades: 1, signals: 1, evaluations: 1 } },
      }),
    ).toThrow(/comparison is missing/);
  });

  it('requires the isolated no-credentials environment', () => {
    const safeEnv = {
      RUNTIME_FEEDBACK_ISOLATED_REDIS: 'true',
      MAKE_ORDERS: 'false',
      TRADEJS_EXTERNAL_ORDER_PLACEMENT: 'false',
      TRADEJS_TIMESCALE_READ_ONLY: 'true',
      REDIS_HOST: 'runtime-feedback-redis-1',
      PGOPTIONS: '-c default_transaction_read_only=on',
    };
    expect(() => assertRuntimeFeedbackReplaySafety(safeEnv)).not.toThrow();
    expect(() =>
      assertRuntimeFeedbackReplaySafety({
        ...safeEnv,
        REDIS_HOST: 'redis',
      }),
    ).toThrow(/isolated Redis/);
    expect(() =>
      assertRuntimeFeedbackReplaySafety({
        ...safeEnv,
        BYBIT_API_KEY: 'must-not-be-mounted',
      }),
    ).toThrow(/forbidden credentials: BYBIT_API_KEY/);
  });

  it('builds a cache-only replay followed by evidence extraction', () => {
    const commands = buildRuntimeFeedbackReplayCommands({
      cliPath: '/app/node_modules/.bin/tradejs',
      runtimeEvidencePath: '/runtime-evidence/runtime-evidence.json',
      replayEvidencePath: '/runtime-feedback/replay-runtime-evidence.json',
      userName: 'root',
      connectorName: 'bybit',
      deploymentId: 'production',
      interval: '15',
      startTime: 1_000,
      endTime: 2_000,
    });
    expect(commands[0]).toContain('--cacheOnly');
    expect(commands[0]).toContain('--runtimeEvidence');
    expect(commands[1]).toContain('replay-runtime-evidence');
    expect(commands[1]).toContain(
      '/runtime-feedback/replay-runtime-evidence.json',
    );
  });
});
