import {
  applyExecutionSlippage,
  calculateEffectiveSlippageBps,
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
      }),
    ).toBe(50);
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
