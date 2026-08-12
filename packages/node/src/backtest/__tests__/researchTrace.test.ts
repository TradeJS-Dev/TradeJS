import type { Signal } from '@tradejs/types';
import { resolveCoreResearchSetupIdentity } from '../researchTrace';

const makeSignal = (
  additionalIndicators?: Record<string, unknown>,
): Signal => ({
  signalId: 'runtime-uuid',
  strategy: 'GridClassic',
  symbol: 'ETHUSDT',
  interval: '15',
  direction: 'SHORT',
  timestamp: 123_000,
  prices: {
    currentPrice: 100,
    takeProfitPrice: 90,
    stopLossPrice: 105,
    riskRatio: 2,
  },
  figures: {},
  indicators: {},
  additionalIndicators,
});

describe('core research setup identity', () => {
  it('prefers a strategy setup id over a runtime-generated signal id', () => {
    expect(
      resolveCoreResearchSetupIdentity(
        makeSignal({
          executionContext: {
            setupId: 'upper:1700000000000',
          },
        }),
      ),
    ).toEqual({
      setupIdentity: 'GridClassic|ETHUSDT|SHORT|setupId:upper:1700000000000',
      setupIdentitySource: 'strategy-context',
    });
  });

  it('uses a deterministic signal-time fallback when strategy context has no id', () => {
    expect(
      resolveCoreResearchSetupIdentity(makeSignal({ quality: 4 })),
    ).toEqual({
      setupIdentity: 'GridClassic|ETHUSDT|SHORT|123000',
      setupIdentitySource: 'signal-time-fallback',
    });
  });
});
