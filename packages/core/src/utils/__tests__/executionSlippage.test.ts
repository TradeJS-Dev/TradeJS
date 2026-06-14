import {
  applyExecutionSlippage,
  calculateDelayRiskBps,
  calculateEffectiveSlippageBps,
  calculateExecutionSlippageBreakdown,
  extractExecutionDelayRiskBps,
  extractExecutionMarketImpactBps,
  extractExecutionSpreadBps,
} from '../executionSlippage';

describe('executionSlippage utils', () => {
  it('calculates effective slippage from base, spread multiplier, and market impact', () => {
    expect(
      calculateEffectiveSlippageBps({
        baseSlippageBps: 25,
        spreadBps: 12,
        spreadMultiplier: 1.5,
        marketImpactBps: 7,
        delayRiskBps: 4,
      }),
    ).toBe(54);

    expect(
      calculateExecutionSlippageBreakdown({
        baseSlippageBps: 25,
        spreadBps: 12,
        spreadMultiplier: 1.5,
        marketImpactBps: 7,
        delayRiskBps: 4,
      }),
    ).toEqual({
      baseSlippageBps: 25,
      spreadBps: 12,
      spreadMultiplier: 1.5,
      spreadSlippageBps: 18,
      marketImpactBps: 7,
      delayRiskBps: 4,
      effectiveSlippageBps: 54,
    });
  });

  it('calculates delay risk from median recent close movement', () => {
    expect(
      calculateDelayRiskBps({
        closes: [100, 101, 100, 102, 101],
        intervalMs: 1_000,
        expectedDelayMs: 1_000,
        multiplier: 1,
        maxBps: 100,
      }),
    ).toBeCloseTo(99.505, 3);
  });

  it('caps delay risk and disables default extracted delay risk', () => {
    expect(
      calculateDelayRiskBps({
        closes: [100, 110, 90],
        intervalMs: 1_000,
        expectedDelayMs: 1_000,
        multiplier: 1,
        maxBps: 50,
      }),
    ).toBe(50);

    expect(
      extractExecutionDelayRiskBps({
        interval: '15',
        indicators: {
          candles15m: [{ close: 100 }, { close: 101 }, { close: 102 }],
        },
        additionalIndicators: {},
      }),
    ).toBe(0);
  });

  it('applies adverse slippage for entry and exit prices', () => {
    expect(
      applyExecutionSlippage({
        price: 100,
        direction: 'LONG',
        stage: 'entry',
        baseSlippageBps: 50,
      }),
    ).toBeCloseTo(100.5);
    expect(
      applyExecutionSlippage({
        price: 100,
        direction: 'LONG',
        stage: 'exit',
        baseSlippageBps: 50,
      }),
    ).toBeCloseTo(99.5);
    expect(
      applyExecutionSlippage({
        price: 100,
        direction: 'SHORT',
        stage: 'entry',
        baseSlippageBps: 50,
      }),
    ).toBeCloseTo(99.5);
    expect(
      applyExecutionSlippage({
        price: 100,
        direction: 'SHORT',
        stage: 'exit',
        baseSlippageBps: 50,
      }),
    ).toBeCloseTo(100.5);
  });

  it('extracts explicit and market-context execution inputs from signals', () => {
    expect(
      extractExecutionSpreadBps({
        additionalIndicators: {
          executionSlippage: {
            spreadBps: 11,
            marketImpactBps: 3,
          },
        },
      }),
    ).toBe(11);
    expect(
      extractExecutionMarketImpactBps({
        additionalIndicators: {
          executionSlippage: {
            spreadBps: 11,
            marketImpactBps: 3,
          },
        },
      }),
    ).toBe(3);
    expect(
      extractExecutionSpreadBps({
        additionalIndicators: {
          baseContext: {
            relative: {
              execution: {
                targetVenue: {
                  spreadBps: 19,
                },
              },
            },
          },
        },
      }),
    ).toBe(19);
  });

  it('ignores stale and unavailable target venue spreads', () => {
    expect(
      extractExecutionSpreadBps({
        additionalIndicators: {
          marketContext: {
            execution: {
              targetVenue: {
                available: false,
                spreadBps: 200,
              },
            },
          },
          baseContext: {
            relative: {
              execution: {
                targetVenue: {
                  stale: true,
                  spreadBps: 150,
                },
              },
            },
          },
        },
      }),
    ).toBeNull();

    expect(
      extractExecutionSpreadBps({
        additionalIndicators: {
          executionSlippage: {
            spreadBps: 12,
          },
          baseContext: {
            relative: {
              execution: {
                targetVenue: {
                  stale: true,
                  spreadBps: 150,
                },
              },
            },
          },
        },
      }),
    ).toBe(12);
  });
});
