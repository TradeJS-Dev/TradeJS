import type { AiPayload } from '@tradejs/types';
import {
  collectAiPocketFeatures,
  searchAiPockets,
  type AiPocketSearchRow,
} from '../lib/aiPocketSearch';

describe('aiPocketSearch', () => {
  it('collects causal payload fields and derived directional indicator support', () => {
    const payload = {
      signal: {
        symbol: 'BTCUSDT',
        signalId: 's1',
        interval: '60',
        direction: 'LONG',
        timestamp: 1000,
        strategy: 'LiquidityZones',
        prices: {
          currentPrice: 100,
          takeProfitPrice: 110,
          stopLossPrice: 95,
        },
      },
      figures: {},
      indicators: {},
      additionalIndicators: {
        baseContext: {
          raw: {
            price: {
              current: 100,
            },
            trend: {
              maFast: 95,
              maSlow: 90,
            },
            momentum: {
              macd: {
                histogram: 1.2,
                slope: 0.1,
              },
            },
            participation: {
              obv: {
                slope: 5,
              },
            },
          },
          liquidityZonesContext: {
            approvalAllowedNow: true,
            deterministicQuality: 5,
          },
          tradeResult: {
            profit: 500,
          },
        },
      },
    } satisfies AiPayload;

    const features = collectAiPocketFeatures({
      payload,
      gateContext: {
        approvalAllowedNow: true,
        quality: 5,
      },
    });

    expect(features['signal.direction']).toBe('LONG');
    expect(
      features['additionalIndicators.baseContext.tradeResult.profit'],
    ).toBeUndefined();
    expect(features['gate.quality']).toBeUndefined();
    expect(
      features[
        'additionalIndicators.baseContext.liquidityZonesContext.approvalAllowedNow'
      ],
    ).toBeUndefined();
    expect(features['derived.maFastAligned']).toBe(true);
    expect(features['derived.maSlowAligned']).toBe(true);
    expect(features['derived.macdHistogramAligned']).toBe(true);
    expect(features['derived.obvSlopeAligned']).toBe(true);
    expect(features['derived.directIndicatorSupportCount']).toBe(6);
  });

  it('finds profitable and losing pockets across predicate combinations', () => {
    const rows: AiPocketSearchRow[] = [
      {
        profit: 10,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        direction: 'SHORT',
        timestamp: 0,
        symbol: 'A',
        features: { a: true, b: 'x', n: 5 },
      },
      {
        profit: 8,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        direction: 'SHORT',
        timestamp: 1,
        symbol: 'B',
        features: { a: true, b: 'x', n: 4 },
      },
      {
        profit: -2,
        profitableTrade: false,
        aiApproved: false,
        quality: 2,
        direction: 'SHORT',
        timestamp: 2,
        symbol: 'C',
        features: { a: true, b: 'y', n: 1 },
      },
      {
        profit: -6,
        profitableTrade: false,
        aiApproved: false,
        quality: 1,
        direction: 'LONG',
        timestamp: 3,
        symbol: 'D',
        features: { a: false, b: 'x', n: 5 },
      },
      {
        profit: -5,
        profitableTrade: false,
        aiApproved: false,
        quality: 1,
        direction: 'LONG',
        timestamp: 4,
        symbol: 'E',
        features: { a: false, b: 'y', n: 0 },
      },
      {
        profit: 3,
        profitableTrade: true,
        aiApproved: true,
        quality: 4,
        direction: 'SHORT',
        timestamp: 5,
        symbol: 'F',
        features: { a: true, b: 'x', n: 6 },
      },
    ];

    const result = searchAiPockets(rows, {
      minSupport: 2,
      minProfitFactor: 1.1,
      maxDepth: 2,
      maxAtomicPredicates: 20,
      maxCombinations: 200,
      top: 10,
    });

    expect(
      result.positivePockets.some(
        (pocket) =>
          pocket.condition.includes('a == true') &&
          pocket.condition.includes('b == "x"') &&
          pocket.summary.totalProfit === 21,
      ),
    ).toBe(true);
    expect(
      result.negativePockets.some(
        (pocket) =>
          pocket.condition.includes('a == false') &&
          pocket.summary.totalProfit === -11,
      ),
    ).toBe(true);
  });
});
