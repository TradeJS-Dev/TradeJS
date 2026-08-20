import {
  activeRuntimeEvidenceStrategies,
  parseRuntimeEvidenceDeploymentSnapshot,
  runtimeDeploymentFromEvidence,
} from '../lib/runtimeEvidenceDeployment';

const snapshot = {
  schemaVersion: 2,
  id: 'production',
  deploymentCompositionId: 'dc1:1111111111111111',
  label: 'Production',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
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
      strategyPackageVersion: '3.0.1',
      strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.1' },
      runtimePackageVersion: '3.2.0',
      strategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
    },
    {
      strategyName: 'TrendShift',
      strategyRevision: 'sr1:1111111111111111',
      enabled: false,
      controlState: 'entries_paused',
      interval: '15',
      universe: 'crypto',
      strategyPackage: '@tradejs/strategy-trend-shift',
      strategyPackageVersion: '3.0.0',
      strategyDependencyVersions: { '@tradejs/strategy-kit': '3.0.0' },
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
      deploymentCompositionId: 'dc1:1111111111111111',
      strategies: [
        {
          strategyName: 'DoubleTap',
          strategyRevision: 'sr1:5555555555555555',
          enabled: true,
        },
        {
          strategyName: 'TrendShift',
          strategyRevision: 'sr1:1111111111111111',
          enabled: false,
        },
      ],
    });
  });

  it('rejects evidence without package-bound strategy revisions', () => {
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
