const mockGetData = jest.fn();
const mockGetKeys = jest.fn();
const mockSetDataStrict = jest.fn();

jest.mock('../redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  getKeys: (...args: unknown[]) => mockGetKeys(...args),
  setDataStrict: (...args: unknown[]) => mockSetDataStrict(...args),
  redisKeys: {
    runtimeDeploymentCompositionState: (
      userName: string,
      deploymentId: string,
    ) => `state:${userName}:${deploymentId}`,
    runtimeDeploymentCompositionEvents: (
      userName: string,
      deploymentId: string,
    ) => `events:${userName}:${deploymentId}:`,
    runtimeDeploymentCompositionEvent: (
      userName: string,
      deploymentId: string,
      eventId: string,
    ) => `events:${userName}:${deploymentId}:${eventId}`,
  },
}));

import type { RuntimeDeployment } from '@tradejs/types';
import {
  isRuntimeDeploymentCompositionEvent,
  loadRuntimeDeploymentCompositionEvents,
  observeRuntimeDeploymentComposition,
} from '../runtimeDeploymentEvents';

const deployment = (
  compositionDigit: number,
  strategies: Array<[string, number]>,
): RuntimeDeployment => ({
  id: 'Production Main',
  deploymentCompositionId: `dc1:${String(compositionDigit).repeat(16)}`,
  label: 'Production',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'crypto-main',
  enabled: true,
  strategies: strategies.map(([strategyName, revisionDigit]) => ({
    strategyName,
    strategyRevision: `sr1:${String(revisionDigit).repeat(16)}`,
    enabled: true,
    controlState: 'active',
  })),
});

const observedStrategies = (
  strategies: Array<[string, number, string]>,
): Array<{
  strategyName: string;
  strategyRevision: string;
  strategyPackage: string;
  strategyPackageVersion: string;
}> =>
  strategies.map(([strategyName, revisionDigit, strategyPackageVersion]) => ({
    strategyName,
    strategyRevision: `sr1:${String(revisionDigit).repeat(16)}`,
    strategyPackage: `@tradejs/strategy-${strategyName.toLowerCase()}`,
    strategyPackageVersion,
  }));

describe('runtime deployment composition events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetData.mockResolvedValue(null);
    mockGetKeys.mockResolvedValue([]);
    mockSetDataStrict.mockResolvedValue(undefined);
  });

  it('records each observed transition once and preserves a rollback', async () => {
    const store = new Map<string, unknown>();
    mockGetData.mockImplementation(
      async (key: string) => store.get(key) ?? null,
    );
    mockGetKeys.mockImplementation(async (prefix: string) =>
      [...store.keys()].filter((key) => key.startsWith(prefix)),
    );
    mockSetDataStrict.mockImplementation(
      async (key: string, value: unknown) => {
        store.set(key, value);
      },
    );
    const first = deployment(1, [
      ['Beta', 2],
      ['Alpha', 1],
    ]);
    const second = deployment(2, [
      ['Alpha', 3],
      ['Beta', 4],
    ]);
    const firstStrategies = observedStrategies([
      ['Beta', 2, '1.0.0'],
      ['Alpha', 1, '1.0.0'],
    ]);
    const secondStrategies = observedStrategies([
      ['Alpha', 3, '2.0.0'],
      ['Beta', 4, '1.0.0'],
    ]);

    const initial = await observeRuntimeDeploymentComposition({
      userName: 'root',
      deployment: first,
      strategies: firstStrategies,
      observedAt: 100,
    });
    const duplicate = await observeRuntimeDeploymentComposition({
      userName: 'root',
      deployment: first,
      strategies: firstStrategies,
      observedAt: 200,
    });
    const changed = await observeRuntimeDeploymentComposition({
      userName: 'root',
      deployment: second,
      strategies: secondStrategies,
      observedAt: 300,
    });
    const rollback = await observeRuntimeDeploymentComposition({
      userName: 'root',
      deployment: first,
      strategies: firstStrategies,
      observedAt: 400,
    });

    expect(duplicate).toBeNull();
    expect(initial?.strategies.map(({ strategyName }) => strategyName)).toEqual(
      ['Alpha', 'Beta'],
    );
    expect(changed?.deploymentCompositionId).toBe('dc1:2222222222222222');
    expect(rollback?.deploymentCompositionId).toBe('dc1:1111111111111111');

    const events = await loadRuntimeDeploymentCompositionEvents(
      'root',
      'Production Main',
    );
    expect(events.map(({ observedAt }) => observedAt)).toEqual([100, 300, 400]);
    expect(
      events.map(({ deploymentCompositionId }) => deploymentCompositionId),
    ).toEqual([
      'dc1:1111111111111111',
      'dc1:2222222222222222',
      'dc1:1111111111111111',
    ]);
  });

  it('rejects malformed stored events', () => {
    expect(
      isRuntimeDeploymentCompositionEvent({
        schema: 'tradejs-runtime-deployment-composition-event/v1',
        eventId: 'event',
        deploymentId: 'production',
        deploymentCompositionId: 'dc1:not-a-hash',
        observedAt: 100,
        strategies: [],
      }),
    ).toBe(false);
  });

  it('enriches an existing event that predates package metadata', async () => {
    const current = deployment(1, [['Alpha', 1]]);
    mockGetData.mockResolvedValue({
      schema: 'tradejs-runtime-deployment-composition-event/v1',
      eventId: 'legacy',
      deploymentId: 'production-main',
      deploymentCompositionId: 'dc1:1111111111111111',
      observedAt: 100,
      strategies: [
        {
          strategyName: 'Alpha',
          strategyRevision: 'sr1:1111111111111111',
        },
      ],
    });

    const enriched = await observeRuntimeDeploymentComposition({
      userName: 'root',
      deployment: current,
      strategies: observedStrategies([['Alpha', 1, '1.0.0']]),
      observedAt: 200,
    });

    expect(enriched?.strategies).toEqual([
      {
        strategyName: 'Alpha',
        strategyRevision: 'sr1:1111111111111111',
        strategyPackage: '@tradejs/strategy-alpha',
        strategyPackageVersion: '1.0.0',
      },
    ]);
    expect(mockSetDataStrict).toHaveBeenCalledTimes(2);
  });
});
