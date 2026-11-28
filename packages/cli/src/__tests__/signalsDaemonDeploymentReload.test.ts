import type {
  PortfolioStrategyEntry,
  RuntimeDeployment,
  Signal,
} from '@tradejs/types';

jest.mock('@tradejs/infra/redis', () => ({
  ...jest.requireActual('@tradejs/infra/redis'),
  setData: jest.fn(),
  setHashJsonFields: jest.fn(),
}));
jest.mock('@tradejs/node/cli', () => ({
  ...jest.requireActual('@tradejs/node/cli'),
  makeScreenshots: jest.fn(),
  sendToTG: jest.fn(),
}));

jest.mock('@tradejs/infra/runtimeHeartbeats', () => ({
  saveRuntimeDeploymentHeartbeat: jest.fn(),
}));
jest.mock('@tradejs/infra/runtimeDeploymentEvents', () => ({
  observeRuntimeDeploymentComposition: jest.fn(),
}));
jest.mock('@tradejs/node/runtimeStrategies', () => ({
  getRuntimeDeployment: jest.fn(),
}));
jest.mock('@tradejs/node/connectors', () => ({
  DEFAULT_CONNECTOR_NAME: 'bybit',
  getConnectorCreatorByName: jest.fn(),
  resolveConnectorName: jest.fn(async (value: string) => value),
}));
jest.mock('../lib/signals/runtimeStrategies', () => ({
  loadRuntimeStrategies: jest.fn(async () => []),
}));
jest.mock('../lib/signals/portfolioLiveCycle', () => ({
  runPortfolioLiveCycle: jest.fn(),
}));
jest.mock('../lib/runtimeEvidenceCompositionSnapshots', () => {
  const actual = jest.requireActual(
    '../lib/runtimeEvidenceCompositionSnapshots',
  );
  return {
    ...actual,
    captureRuntimeEvidenceCompositionSnapshot: jest.fn(),
  };
});
jest.mock('../lib/signals/daemon', () => ({
  getSignalsHeartbeatStatus: jest.fn(),
  runSignalsDaemon: jest.fn(
    async ({ runCycle }: { runCycle: () => Promise<void> }) => {
      await runCycle();
      await runCycle();
    },
  ),
}));

import { getRuntimeDeployment } from '@tradejs/node/runtimeStrategies';
import { observeRuntimeDeploymentComposition } from '@tradejs/infra/runtimeDeploymentEvents';
import { captureRuntimeEvidenceCompositionSnapshot } from '../lib/runtimeEvidenceCompositionSnapshots';
import { createSignalsRunner } from '../lib/signals/runner';
import { loadRuntimeStrategies } from '../lib/signals/runtimeStrategies';
import { runPortfolioLiveCycle } from '../lib/signals/portfolioLiveCycle';
import { saveRuntimeDeploymentHeartbeat } from '@tradejs/infra/runtimeHeartbeats';
import { redisKeys, setData, setHashJsonFields } from '@tradejs/infra/redis';
import { makeScreenshots, sendToTG } from '@tradejs/node/cli';

const deployment = (revisionDigit: number): RuntimeDeployment => ({
  id: 'doubletap-forward',
  deploymentCompositionId: `dc1:${String(revisionDigit).repeat(16)}`,
  label: 'DoubleTap forward',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      strategyRevision: `sr1:${String(revisionDigit).repeat(16)}`,
      enabled: true,
      controlState: 'entries_paused',
    },
  ],
});

describe('signals daemon deployment reload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(captureRuntimeEvidenceCompositionSnapshot)
      .mockResolvedValue(undefined);
    jest.mocked(observeRuntimeDeploymentComposition).mockResolvedValue(null);
  });

  it('loads the current deployment again for every cycle', async () => {
    const first = deployment(2);
    const second = deployment(3);
    jest
      .mocked(getRuntimeDeployment)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await createSignalsRunner({
      userName: 'root',
      projectRoot: '/project',
      interval: '15',
      connectorName: 'bybit',
      deploymentId: 'doubletap-forward',
      makeOrders: false,
      notify: false,
      skipScreenshots: true,
      updateOnly: false,
      cacheOnly: true,
      showTickersList: false,
      showSkipStats: false,
    }).runDaemon();

    expect(getRuntimeDeployment).toHaveBeenCalledTimes(3);
    expect(
      jest.mocked(loadRuntimeStrategies).mock.calls[0]?.[0].deploymentId,
    ).toBe(first.id);
    expect(
      jest.mocked(loadRuntimeStrategies).mock.calls[1]?.[0].deploymentId,
    ).toBe(second.id);
    expect(observeRuntimeDeploymentComposition).toHaveBeenNthCalledWith(1, {
      userName: 'root',
      deployment: first,
      strategies: [],
    });
    expect(observeRuntimeDeploymentComposition).toHaveBeenNthCalledWith(2, {
      userName: 'root',
      deployment: second,
      strategies: [],
    });
  });

  it('keeps running and retries when a deployment event cannot be saved', async () => {
    const current = deployment(5);
    jest.mocked(getRuntimeDeployment).mockResolvedValue(current);
    jest
      .mocked(observeRuntimeDeploymentComposition)
      .mockRejectedValueOnce(new Error('deployment event storage unavailable'))
      .mockResolvedValueOnce(null);

    await createSignalsRunner({
      userName: 'root',
      projectRoot: '/project',
      interval: '15',
      connectorName: 'bybit',
      deploymentId: 'doubletap-forward',
      makeOrders: false,
      notify: false,
      skipScreenshots: true,
      updateOnly: false,
      cacheOnly: true,
      showTickersList: false,
      showSkipStats: false,
    }).runDaemon();

    expect(observeRuntimeDeploymentComposition).toHaveBeenCalledTimes(2);
    expect(loadRuntimeStrategies).toHaveBeenCalledTimes(2);
  });

  it('keeps running and retries when a composition snapshot cannot be saved', async () => {
    const current = deployment(4);
    const snapshotError = new Error('snapshot storage unavailable');
    const previousProjectSha = process.env.TRADEJS_PROJECT_SHA;
    const previousImageDigest = process.env.TRADEJS_PROJECT_IMAGE_DIGEST;
    process.env.TRADEJS_PROJECT_SHA = '1'.repeat(40);
    process.env.TRADEJS_PROJECT_IMAGE_DIGEST = `sha256:${'2'.repeat(64)}`;
    jest.mocked(getRuntimeDeployment).mockResolvedValue(current);
    jest
      .mocked(captureRuntimeEvidenceCompositionSnapshot)
      .mockRejectedValueOnce(snapshotError)
      .mockResolvedValueOnce(undefined);

    try {
      await createSignalsRunner({
        userName: 'root',
        projectRoot: '/project',
        interval: '15',
        connectorName: 'bybit',
        deploymentId: 'doubletap-forward',
        makeOrders: false,
        notify: false,
        skipScreenshots: true,
        updateOnly: false,
        cacheOnly: true,
        showTickersList: false,
        showSkipStats: false,
      }).runDaemon();

      await new Promise((resolve) => setImmediate(resolve));
      expect(loadRuntimeStrategies).toHaveBeenCalledTimes(2);
      expect(captureRuntimeEvidenceCompositionSnapshot).toHaveBeenCalledTimes(
        2,
      );
    } finally {
      if (previousProjectSha == null) {
        delete process.env.TRADEJS_PROJECT_SHA;
      } else {
        process.env.TRADEJS_PROJECT_SHA = previousProjectSha;
      }
      if (previousImageDigest == null) {
        delete process.env.TRADEJS_PROJECT_IMAGE_DIGEST;
      } else {
        process.env.TRADEJS_PROJECT_IMAGE_DIGEST = previousImageDigest;
      }
    }
  });

  it.each([
    { notify: true, cycleFails: false },
    { notify: false, cycleFails: false },
    { notify: true, cycleFails: true },
  ])(
    'publishes executed portfolio signals with $notify notifications and cycle failure $cycleFails',
    async ({ notify, cycleFails }) => {
      const current = deployment(6);
      jest.mocked(getRuntimeDeployment).mockResolvedValue(current);
      const strategyConfig = { MAX_LOSS_VALUE: 2 };
      const portfolioEntry: PortfolioStrategyEntry = {
        kind: 'portfolio',
        manifest: { name: 'Probe' },
        defaults: strategyConfig,
        parseConfig: () => strategyConfig,
        resolveChildren: () => [],
        selectEntries: () => ({ ranked: [], pending: [] }),
        confirmEntry: () => null,
        execution: { maxPositions: 1, feeRate: 0, slippageBps: 0 },
      };
      jest.mocked(loadRuntimeStrategies).mockResolvedValue([
        {
          ...current.strategies[0],
          interval: '15',
          universe: 'crypto',
          accountId: current.accountId,
          controlState: 'active',
          portfolioEntry,
          strategyConfig,
          selection: { tickers: ['BTCUSDT'] },
          deploymentCompositionId: current.deploymentCompositionId,
          strategyModule: '@tradejs/strategy-probe',
          strategyPackage: '@tradejs/strategy-probe',
          strategyPackageVersion: '1.0.0',
          strategyDependencyVersions: { '@tradejs/core': '3.1.29' },
          runtimePackageVersion: '3.1.29',
          strategyCreator: async () => async () => 'SKIP',
          sourceStrategyConfig: strategyConfig,
        },
      ]);
      const signals: Signal[] = (['15', '60'] as const).map((interval) => ({
        signalId: `portfolio-${interval}`,
        orderId: `order-${interval}`,
        orderStatus: 'completed',
        interval,
        strategy: interval === '15' ? 'TrendFollow' : 'TradingPatterns',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        timestamp: 900_000,
        deploymentId: current.id,
        accountId: current.accountId,
        strategyRevision: current.strategies[0].strategyRevision,
        figures: {},
        indicators: {},
        prices: {
          currentPrice: 100,
          stopLossPrice: 90,
          takeProfitPrice: 120,
          riskRatio: 2,
        },
      }));
      jest
        .mocked(runPortfolioLiveCycle)
        .mockImplementationOnce(async ({ onExecutedSignal }) => {
          for (const signal of signals) onExecutedSignal?.(signal);
          if (cycleFails) throw new Error('later order failed');
          return { closedAt: 900_000, candidates: 2, pending: 0 };
        });

      await createSignalsRunner({
        userName: 'root',
        projectRoot: '/project',
        interval: '15',
        connectorName: 'bybit',
        deploymentId: current.id,
        makeOrders: true,
        notify,
        skipScreenshots: false,
        updateOnly: false,
        cacheOnly: false,
        showTickersList: false,
        showSkipStats: false,
      }).runDaemon();

      expect(runPortfolioLiveCycle).toHaveBeenCalledWith(
        expect.objectContaining({
          entry: portfolioEntry,
          config: strategyConfig,
        }),
      );
      expect(saveRuntimeDeploymentHeartbeat).toHaveBeenCalledWith(
        'root',
        expect.objectContaining({
          deploymentId: current.id,
          cycleStatus: cycleFails ? 'failed' : 'completed',
        }),
      );
      expect(setData).toHaveBeenCalledTimes(2);
      for (const [index, signal] of signals.entries()) {
        expect(setData).toHaveBeenCalledWith(
          redisKeys.storeSignal(signal.symbol, signal.signalId),
          signal,
          expect.objectContaining({ expire: expect.any(Number) }),
        );
        if (notify) {
          expect(makeScreenshots).toHaveBeenNthCalledWith(
            index + 1,
            [signal],
            signal.interval,
            'root',
          );
          expect(sendToTG).toHaveBeenNthCalledWith(
            index + 1,
            [signal],
            signal.interval,
            'root',
            expect.any(Map),
          );
        }
      }
      if (notify) {
        expect(sendToTG).toHaveBeenCalledTimes(2);
        expect(
          Math.max(...jest.mocked(setHashJsonFields).mock.invocationCallOrder),
        ).toBeLessThan(
          jest.mocked(makeScreenshots).mock.invocationCallOrder[0],
        );
      } else {
        expect(makeScreenshots).not.toHaveBeenCalled();
        expect(sendToTG).not.toHaveBeenCalled();
      }
    },
  );
});
