import type { AiPayload } from '@tradejs/types';
import {
  buildAiPocketMarkdownReport,
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
      indicators: {
        legacy: {
          maFast: 91,
        },
      },
      additionalIndicators: {
        baseContext: {
          candle: {
            close: 100,
          },
          prevCandle: {
            close: 99,
          },
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
          derivatives: {
            referenceContexts: {
              BTCUSDT: {
                fundingRate: 0.01,
              },
            },
            summary: {
              pressure: 'neutral',
            },
          },
          liquidityZonesContext: {
            approvalAllowedNow: true,
            deterministicQuality: 5,
            maxAllowedQuality: 5,
            q4ContinuationRecoveryAllowed: true,
          },
          tradeResult: {
            profit: 500,
          },
        },
        marketContext: {
          relative: {
            benchmark: {
              trend: 'bull',
            },
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
      featureProfile: 'compact',
    });

    expect(features['signal.direction']).toBe('LONG');
    expect(features['indicators.legacy.maFast']).toBeUndefined();
    expect(
      features['additionalIndicators.marketContext.relative.benchmark.trend'],
    ).toBeUndefined();
    expect(features['additionalIndicators.baseContext.candle.close']).toBe(
      undefined,
    );
    expect(
      features[
        'additionalIndicators.baseContext.derivatives.referenceContexts.BTCUSDT.fundingRate'
      ],
    ).toBeUndefined();
    expect(
      features['additionalIndicators.baseContext.derivatives.summary.pressure'],
    ).toBe('neutral');
    expect(
      features['additionalIndicators.baseContext.tradeResult.profit'],
    ).toBeUndefined();
    expect(features['gate.quality']).toBeUndefined();
    expect(
      features[
        'additionalIndicators.baseContext.liquidityZonesContext.approvalAllowedNow'
      ],
    ).toBeUndefined();
    expect(
      features[
        'additionalIndicators.baseContext.liquidityZonesContext.maxAllowedQuality'
      ],
    ).toBeUndefined();
    expect(features['derived.maFastAligned']).toBe(true);
    expect(features['derived.maSlowAligned']).toBe(true);
    expect(features['derived.macdHistogramAligned']).toBe(true);
    expect(features['derived.obvSlopeAligned']).toBe(true);
    expect(features['derived.directIndicatorSupportCount']).toBe(6);

    const broadFeatures = collectAiPocketFeatures({
      payload,
    });
    expect(broadFeatures['indicators.legacy.maFast']).toBe(91);
    expect(
      broadFeatures[
        'additionalIndicators.marketContext.relative.benchmark.trend'
      ],
    ).toBe('bull');
    expect(broadFeatures['additionalIndicators.baseContext.candle.close']).toBe(
      100,
    );
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
      dedupeEquivalentSelections: false,
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
    expect(result.predicates[0]).not.toHaveProperty('atomSummary');
    expect(result.positivePockets[0].predicates[0]).not.toHaveProperty('mask');
  });

  it('deduplicates equivalent row-selection pockets', () => {
    const rows: AiPocketSearchRow[] = [
      {
        profit: 10,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        timestamp: 0,
        features: { a: true, aliasA: true },
      },
      {
        profit: 8,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        timestamp: 1,
        features: { a: true, aliasA: true },
      },
      {
        profit: -4,
        profitableTrade: false,
        aiApproved: false,
        quality: 2,
        timestamp: 2,
        features: { a: false, aliasA: false },
      },
      {
        profit: -3,
        profitableTrade: false,
        aiApproved: false,
        quality: 2,
        timestamp: 3,
        features: { a: false, aliasA: false },
      },
    ];

    const deduped = searchAiPockets(rows, {
      minSupport: 2,
      maxDepth: 1,
      maxAtomicPredicates: 10,
      maxCombinations: 20,
      top: 10,
    });
    const notDeduped = searchAiPockets(rows, {
      minSupport: 2,
      maxDepth: 1,
      maxAtomicPredicates: 10,
      maxCombinations: 20,
      dedupeEquivalentSelections: false,
      top: 10,
    });

    expect(deduped.positivePockets).toHaveLength(1);
    expect(notDeduped.positivePockets.length).toBeGreaterThan(
      deduped.positivePockets.length,
    );
    expect(deduped.stats.duplicatePocketsSkipped).toBeGreaterThan(0);
  });

  it('evaluates pocket candidates on validation rows', () => {
    const trainRows: AiPocketSearchRow[] = [
      {
        profit: 10,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        timestamp: 0,
        features: { a: true },
      },
      {
        profit: 8,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        timestamp: 1,
        features: { a: true },
      },
      {
        profit: -3,
        profitableTrade: false,
        aiApproved: false,
        quality: 2,
        timestamp: 2,
        features: { a: false },
      },
    ];
    const validationRows: AiPocketSearchRow[] = [
      {
        profit: -5,
        profitableTrade: false,
        aiApproved: false,
        quality: 2,
        timestamp: 3,
        features: { a: true },
      },
      {
        profit: 2,
        profitableTrade: true,
        aiApproved: true,
        quality: 4,
        timestamp: 4,
        features: { a: false },
      },
    ];

    const result = searchAiPockets(trainRows, {
      validationRows,
      minSupport: 2,
      minValidationSupport: 1,
      maxDepth: 1,
      maxAtomicPredicates: 10,
      maxCombinations: 20,
      top: 10,
    });

    expect(result.validationBaseline?.support).toBe(2);
    expect(result.stats.validationRows).toBe(2);
    expect(result.positivePockets[0].validationSummary).toEqual(
      expect.objectContaining({
        support: 1,
        totalProfit: -5,
      }),
    );
  });

  it('emits search progress updates', () => {
    const rows: AiPocketSearchRow[] = [
      {
        profit: 10,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        timestamp: 0,
        features: { a: true, b: 'x', c: 1 },
      },
      {
        profit: -2,
        profitableTrade: false,
        aiApproved: false,
        quality: 2,
        timestamp: 1,
        features: { a: true, b: 'y', c: 2 },
      },
      {
        profit: 4,
        profitableTrade: true,
        aiApproved: true,
        quality: 4,
        timestamp: 2,
        features: { a: false, b: 'x', c: 3 },
      },
      {
        profit: -3,
        profitableTrade: false,
        aiApproved: false,
        quality: 1,
        timestamp: 3,
        features: { a: false, b: 'y', c: 4 },
      },
    ];
    const progress: Array<{
      phase: string;
      current: number;
      total: number;
      done: boolean;
    }> = [];

    const result = searchAiPockets(rows, {
      minSupport: 1,
      maxDepth: 2,
      maxAtomicPredicates: 12,
      maxCombinations: 100,
      progressInterval: 1,
      onProgress: (event) => {
        progress.push({
          phase: event.phase,
          current: event.current,
          total: event.total,
          done: event.done,
        });
      },
    });

    expect(result.stats.estimatedCombinations).toBeGreaterThan(0);
    expect(progress.length).toBeGreaterThan(0);
    expect(new Set(progress.map((event) => event.phase))).toEqual(
      new Set(['features', 'predicates', 'masks', 'combinations']),
    );
    expect(progress.at(-1)).toEqual(
      expect.objectContaining({
        done: true,
      }),
    );
    expect(progress.at(-1)!.current).toBeLessThanOrEqual(
      progress.at(-1)!.total,
    );
  });

  it('builds a markdown report with run, baseline, and pocket sections', () => {
    const rows: AiPocketSearchRow[] = [
      {
        profit: 10,
        profitableTrade: true,
        aiApproved: true,
        quality: 5,
        timestamp: 0,
        symbol: 'A',
        features: { a: true, b: 'x' },
      },
      {
        profit: -3,
        profitableTrade: false,
        aiApproved: false,
        quality: 2,
        timestamp: 1,
        symbol: 'B',
        features: { a: false, b: 'y' },
      },
    ];
    const search = searchAiPockets(rows, {
      minSupport: 1,
      maxDepth: 1,
      maxAtomicPredicates: 10,
      maxCombinations: 20,
    });

    const markdown = buildAiPocketMarkdownReport({
      generatedAt: 0,
      run: {
        strategy: 'Example',
        filePaths: ['data/ai/export/example.jsonl'],
        sourceRows: 2,
        selectedRows: 2,
        evaluatedRows: 2,
        scope: 'all',
        scopeRows: 2,
        trainRows: 2,
        validationRows: 0,
        scanned: 2,
        dateSkipped: 0,
        failed: 0,
        recent: 0,
        skip: 0,
        since: null,
        until: null,
        period: null,
        minQuality: 4,
        qualityThresholds: [4],
        includeSymbol: false,
        includeGateContext: false,
        validationSplit: 0,
        minValidationSupport: 0,
        reportPath: 'data/ai/output/report.md',
        search: {
          maxDepth: 1,
          minSupport: 1,
          minProfitFactor: 1,
          minWinRate: 0,
          minTotalProfit: 0,
          maxAtomicPredicates: 10,
          maxCombinations: 20,
          top: 10,
        },
      },
      currentGate: {
        qualityThresholds: [
          {
            threshold: 4,
            label: 'q4+',
            summary: {
              approved: 1,
              avgApprovedTradesPerDay: 1,
              avgProfitApprovedPerDay: 10,
              approvedRisk: {
                winRate: 1,
                profitFactor: null,
                totalProfit: 10,
                maxDrawdown: 0,
              },
            },
          } as any,
        ],
      },
      pocketSearch: search,
      errors: [],
    });

    expect(markdown).toContain('# AI Pocket Search Report');
    expect(markdown).toContain('| strategy | Example |');
    expect(markdown).toContain('## Current Gate qN+ Baseline');
    expect(markdown).toContain('## Top Positive Pockets');
    expect(markdown).toContain('data/ai/output/report.md');
  });
});
