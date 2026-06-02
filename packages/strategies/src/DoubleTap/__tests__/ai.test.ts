import { doubleTapAiAdapter } from '../adapters/ai';

const createBaseContext = (overrides: Record<string, unknown> = {}) => ({
  regime: {
    session: {
      sessionPhase: 'europe',
    },
    trend: {
      bias: 'bull',
    },
    momentum: {
      bodyStrength: 0.75,
    },
  },
  structure: {
    swing: {
      bias: 'bull',
    },
    localRange: {
      breakoutState: 'above_high_level',
      barsSinceBreakout: 0,
    },
  },
  participation: {
    volume: {
      volumeRel20: 3.5,
    },
  },
  relative: {
    benchmark: {
      trendAlignment: 'aligned_bull',
      bias: 'bull',
    },
    execution: {
      venueSpreadZScore: 1.5,
    },
  },
  derivatives: {
    summary: {
      directionAligned: true,
      riskFlags: [],
    },
  },
  ...overrides,
});

describe('doubleTapAiAdapter', () => {
  it('copies DoubleTap context into AI payload', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            patternKind: 'double_bottom',
            signalDirection: 'LONG',
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: createBaseContext(),
        },
      } as any,
    } as any);

    expect((result as any).additionalIndicators.doubleTapContext).toEqual(
      expect.objectContaining({
        patternKind: 'double_bottom',
        signalDirection: 'LONG',
        baseContextAvailable: true,
        deterministicQuality: 1,
        approvalAllowedNow: false,
      }),
    );
  });

  it('approves compact neckline breakouts when baseContext supports the gate', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            regime: {
              session: {
                sessionPhase: 'off_hours',
              },
              trend: {
                bias: 'bull',
              },
            },
          }),
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 0.6,
          },
        },
      },
      analysis: {
        approved: false,
        quality: 1,
        direction: null,
      },
    } as any);

    expect(result?.quality).toBe(5);
    expect(result?.direction).toBe('LONG');
  });

  it('caps compact breakouts when baseContext is missing', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'SHORT',
            height: 10,
            breakoutDistancePct: 0.5,
          },
        },
      },
      analysis: {
        approved: false,
        quality: 1,
        direction: null,
      },
    } as any);

    expect(result?.quality).toBe(2);
    expect(result?.direction).toBeNull();
  });

  it('rejects extended breakouts', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext(),
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 3,
          },
        },
      },
      analysis: {
        approved: true,
        quality: 5,
        direction: 'LONG',
      },
    } as any);

    expect(result?.quality).toBe(1);
    expect(result?.direction).toBeNull();
  });

  it('downgrades q4 approval pockets with neutral venue spread', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            relative: {
              benchmark: {
                trendAlignment: 'aligned_bull',
                bias: 'bull',
              },
              execution: {
                venueSpreadZScore: 0.2,
              },
            },
          }),
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 0.4,
          },
        },
      },
      analysis: {
        approved: true,
        quality: 4,
        direction: 'LONG',
      },
    } as any);

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('downgrades q4 approval pockets with negative venue spread', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            relative: {
              benchmark: {
                trendAlignment: 'aligned_bull',
                bias: 'bull',
              },
              execution: {
                venueSpreadZScore: -1.5,
              },
            },
          }),
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 0.4,
          },
        },
      },
      analysis: {
        approved: true,
        quality: 4,
        direction: 'LONG',
      },
    } as any);

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('keeps q5 high precision pockets despite neutral venue spread', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            regime: {
              session: {
                sessionPhase: 'off_hours',
              },
              trend: {
                bias: 'bull',
              },
              momentum: {
                bodyStrength: 0.75,
              },
            },
            relative: {
              benchmark: {
                trendAlignment: 'aligned_bull',
                bias: 'bull',
              },
              execution: {
                venueSpreadZScore: 0.2,
              },
            },
          }),
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 0.6,
          },
        },
      },
      analysis: {
        approved: false,
        quality: 1,
        direction: null,
      },
    } as any);

    expect(result?.quality).toBe(5);
    expect(result?.direction).toBe('LONG');
  });
});
