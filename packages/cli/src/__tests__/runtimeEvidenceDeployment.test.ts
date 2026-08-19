import {
  activeRuntimeEvidenceStrategies,
  parseRuntimeEvidenceDeploymentSnapshot,
  runtimeDeploymentFromEvidence,
} from '../lib/runtimeEvidenceDeployment';

const snapshot = {
  schemaVersion: 1,
  id: 'production',
  label: 'Production',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      version: 5,
      enabled: true,
      controlState: 'active',
      interval: '15',
      universe: 'crypto',
      strategyPackage: '@tradejs/strategy-double-tap',
      strategyPackageVersion: '3.0.1',
      runtimePackageVersion: '3.2.0',
      strategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
    },
    {
      strategyName: 'TrendShift',
      version: 1,
      enabled: false,
      controlState: 'entries_paused',
      interval: '15',
      universe: 'crypto',
      strategyPackage: '@tradejs/strategy-trend-shift',
      strategyPackageVersion: '3.0.0',
      runtimePackageVersion: '3.2.0',
      strategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
    },
  ],
};

describe('runtime evidence deployment snapshot', () => {
  it('is the exact source of replay strategy selection', () => {
    const parsed = parseRuntimeEvidenceDeploymentSnapshot(snapshot);

    expect(
      activeRuntimeEvidenceStrategies(parsed).map(
        ({ strategyName }) => strategyName,
      ),
    ).toEqual(['DoubleTap']);
    expect(runtimeDeploymentFromEvidence(parsed)).toMatchObject({
      id: 'production',
      strategies: [
        { strategyName: 'DoubleTap', version: 5, enabled: true },
        { strategyName: 'TrendShift', version: 1, enabled: false },
      ],
    });
  });

  it('rejects evidence without package-bound versioned strategies', () => {
    expect(() =>
      parseRuntimeEvidenceDeploymentSnapshot({
        ...snapshot,
        strategies: [
          {
            ...snapshot.strategies[0],
            runtimePackageVersion: null,
          },
        ],
      }),
    ).toThrow('Runtime evidence deployment strategy snapshot is invalid');
  });

  it('rejects a strategy snapshot whose immutable config has another scope', () => {
    expect(() =>
      parseRuntimeEvidenceDeploymentSnapshot({
        ...snapshot,
        strategies: [
          {
            ...snapshot.strategies[0],
            strategyConfig: { INTERVAL: '60', UNIVERSE: 'crypto' },
          },
        ],
      }),
    ).toThrow('Runtime evidence strategy config does not match its scope');
  });
});
