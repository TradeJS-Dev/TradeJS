import { trendLineAiAdapter } from '../adapters/ai';

const makeBaseContext = ({
  primaryIssue,
  totalMarketCapUsd,
  trendPersistence,
}: {
  primaryIssue?: string;
  totalMarketCapUsd?: number;
  trendPersistence?: number;
} = {}) => ({
  raw: {
    trend: {
      maFast: 102,
      maSlow: 100,
    },
    volatility: {
      atrPct: 1,
    },
  },
  regime: {
    trend:
      trendPersistence == null
        ? undefined
        : {
            persistence: trendPersistence,
          },
    session: {
      sessionPhase: 'europe',
      isOverlap: false,
    },
  },
  participation: {
    volume: {
      volumeRel20: 1.6,
    },
  },
  relative: {
    benchmark: {
      maFast: 102,
      maSlow: 100,
      trendAlignment: 'aligned_bull',
    },
    execution: {
      venueSpreadZScore: 1.2,
    },
    cmcGlobal:
      totalMarketCapUsd == null
        ? undefined
        : {
            totalMarketCapUsd,
          },
  },
  derivatives: {
    summary: {
      directionAligned: true,
      riskFlags: [],
    },
  },
  gateFeatures:
    primaryIssue == null
      ? undefined
      : {
          decisionHints: {
            primaryIssue,
          },
        },
});

const buildTrendlinePayload = (
  baseContext = makeBaseContext(),
  signalOverrides: Record<string, unknown> = {},
) =>
  trendLineAiAdapter.buildPayload?.({
    signal: {
      direction: 'LONG',
      prices: {
        currentPrice: 101,
      },
      additionalIndicators: {
        touches: 5,
        distance: 80,
        trendLine: {
          mode: 'highs',
          points: [
            { timestamp: 1_700_000_000_000, value: 100 },
            { timestamp: 1_700_000_900_000, value: 100 },
          ],
        },
      },
      ...signalOverrides,
    } as any,
    basePayload: {
      figures: {},
      additionalIndicators: {
        baseContext,
      },
    } as any,
  } as any);

describe('trendLineAiAdapter', () => {
  it('copies TrendLine gate features into strategy and base contexts', () => {
    const result = buildTrendlinePayload();

    expect(
      (result as any).additionalIndicators.trendlineContext
        .trendLineGateFeatures,
    ).toMatchObject({
      lineMaturity: 'mature',
      breakoutAcceptance: 'clear_break',
      biasAlignment: 'aligned',
      participationState: 'strong',
    });
    expect(
      (result as any).additionalIndicators.baseContext.trendLineGateFeatures,
    ).toMatchObject({
      lineMaturity: 'mature',
      breakoutAcceptance: 'clear_break',
    });
  });

  it.each([
    {
      name: 'at rounded approval boundary',
      primaryIssue: 'market_context_against',
      totalMarketCapUsd: 2_330_000_000_000,
      trendPersistence: 0.77,
      approvalAllowedNow: true,
    },
    {
      name: 'below market-cap boundary',
      primaryIssue: 'market_context_against',
      totalMarketCapUsd: 2_329_999_999_999,
      trendPersistence: 0.77,
      approvalAllowedNow: false,
    },
    {
      name: 'above trend-persistence boundary',
      primaryIssue: 'market_context_against',
      totalMarketCapUsd: 2_330_000_000_000,
      trendPersistence: 0.7701,
      approvalAllowedNow: false,
    },
    {
      name: 'missing market context',
      approvalAllowedNow: false,
    },
  ])(
    'applies market-context approval pocket only $name',
    ({
      primaryIssue,
      totalMarketCapUsd,
      trendPersistence,
      approvalAllowedNow,
    }) => {
      const result = buildTrendlinePayload(
        makeBaseContext({
          primaryIssue,
          totalMarketCapUsd,
          trendPersistence,
        }),
      );
      const trendlineContext = (result as any).additionalIndicators
        .trendlineContext;

      expect(trendlineContext).toEqual(
        expect.objectContaining({
          gatePrimaryIssue: primaryIssue ?? null,
          cmcTotalMarketCapUsd: totalMarketCapUsd ?? null,
          trendPersistence: trendPersistence ?? null,
          marketContextApprovalPocket: approvalAllowedNow,
          approvalAllowedNow,
        }),
      );
      expect(trendlineContext.deterministicQuality).toBe(
        approvalAllowedNow ? 4 : trendlineContext.baseDeterministicQuality,
      );
    },
  );
});
