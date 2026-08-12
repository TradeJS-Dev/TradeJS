import type {
  AiPayload,
  BaseStrategyContextSnapshot,
  Signal,
} from '@tradejs/types';
import { volatilityCompressionBreakoutAiAdapter } from '../adapters/ai';
import { buildVolatilityCompressionBreakoutGuardrailContext } from '../guardrails';

const buildContext = ({
  direction = 'SHORT',
  stopDistanceBps = 130,
  distanceToTrailStopPct = -3.2,
  momentumRsi = 30,
  price24hPct = -4,
}: {
  direction?: 'LONG' | 'SHORT';
  stopDistanceBps?: number;
  distanceToTrailStopPct?: number;
  momentumRsi?: number;
  price24hPct?: number;
} = {}) => {
  const currentPrice = 100;
  const stopLossPrice =
    direction === 'SHORT'
      ? currentPrice * (1 + stopDistanceBps / 10000)
      : currentPrice * (1 - stopDistanceBps / 10000);

  return buildVolatilityCompressionBreakoutGuardrailContext({
    signalContext: {
      signalDirection: direction,
    },
    baseContext: {
      regime: {
        trend: {
          trendFollow: {
            distanceToTrailStopPct,
          },
        },
        momentum: {
          rsi: momentumRsi,
        },
      },
      raw: {
        price: {
          price24hPct,
        },
      },
    } as unknown as BaseStrategyContextSnapshot,
    prices: {
      currentPrice,
      stopLossPrice,
    },
  });
};

describe('VolatilityCompressionBreakout AI guardrail', () => {
  it('assigns quality 5 to the strongest fresh SHORT breakdown pocket', () => {
    const context = buildContext();

    expect(context.approvalAllowedNow).toBe(true);
    expect(context.deterministicQuality).toBe(5);
    expect(
      context.volatilityCompressionBreakoutGateFeatures.stopDistanceBps,
    ).toBeCloseTo(130);
  });

  it('assigns quality 4 to a valid but less fresh SHORT breakdown', () => {
    const context = buildContext({ price24hPct: -5.5 });

    expect(context.approvalAllowedNow).toBe(true);
    expect(context.deterministicQuality).toBe(4);
  });

  it.each([
    ['LONG direction', { direction: 'LONG' as const }],
    ['narrow stop', { stopDistanceBps: 124.9 }],
    ['weak displacement', { distanceToTrailStopPct: -2.99 }],
    ['oversold momentum', { momentumRsi: 24.9 }],
    ['stale breakdown', { price24hPct: -6.01 }],
  ])('rejects %s at the approval boundary', (_name, overrides) => {
    const context = buildContext(overrides);

    expect(context.approvalAllowedNow).toBe(false);
    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalBlockReasons.length).toBeGreaterThan(0);
  });

  it('rejects legacy local approvals after the 1800d rebuild', () => {
    expect(
      volatilityCompressionBreakoutAiAdapter.postProcessLocalAnalysis?.({
        signal: {
          direction: 'SHORT',
          prices: { takeProfitPrice: 90, stopLossPrice: 105 },
        } as Signal,
        payload: { additionalIndicators: {} } as AiPayload,
        analysis: { direction: 'SHORT', quality: 5 },
      }),
    ).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
        gateDecision: 'rejected',
      }),
    );
  });
});
