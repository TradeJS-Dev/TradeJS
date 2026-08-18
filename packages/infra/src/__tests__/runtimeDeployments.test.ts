import { verifyRuntimeDeployment } from '../runtimeDeployments';

const canonicalDeployment = {
  id: 'doubletap-forward',
  label: 'DoubleTap forward',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      releaseVersion: 2,
      controlState: 'entries_paused',
    },
  ],
};

describe('runtime deployment canonical schema', () => {
  it('accepts only release pointers and operational bindings', () => {
    expect(verifyRuntimeDeployment(canonicalDeployment)).toEqual(
      canonicalDeployment,
    );
  });

  it.each([
    { ...canonicalDeployment, interval: '15' },
    { ...canonicalDeployment, universe: 'crypto' },
    {
      ...canonicalDeployment,
      strategies: [
        { ...canonicalDeployment.strategies[0], config: { INTERVAL: '15' } },
      ],
    },
    {
      ...canonicalDeployment,
      strategies: [
        {
          strategyName: 'DoubleTap',
          releaseVersion: 2,
        },
      ],
    },
  ])('rejects non-canonical deployment %#', (deployment) => {
    expect(() => verifyRuntimeDeployment(deployment)).toThrow(
      'Invalid runtime deployment',
    );
  });
});
