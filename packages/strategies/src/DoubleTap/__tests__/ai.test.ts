import { doubleTapAiAdapter } from '../adapters/ai';

const mergeRecord = (
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> => {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const current = result[key];
    result[key] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
        ? mergeRecord(
            current as Record<string, unknown>,
            value as Record<string, unknown>,
          )
        : value;
  }
  return result;
};

const baseContext = {
  regime: {
    session: {
      sessionPhase: 'europe',
      sessionWindowPhase: 'active',
    },
    trend: {
      bias: 'bull',
    },
    momentum: {
      bodyStrength: 0.75,
      roc1d: -5.25,
    },
  },
  structure: {
    swing: {
      bias: 'bull',
    },
    levels: {
      lowTouchCount20: 1,
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
    cmcGlobal: {
      altVolumeChange24hPct: 0.2,
      btcDominanceChange24hPct: -0.1,
    },
    btcAltRegime: {
      altDispersion24h: 0.04,
    },
  },
  derivatives: {
    summary: {
      directionAligned: true,
      riskFlags: [],
    },
  },
  gateFeatures: {
    setup: {
      rewardToVolatility: 10,
    },
    scores: {
      execution: 50,
    },
    participation: {
      volumeStructureAligned: true,
    },
    relative: {
      benchmarkConflict: false,
    },
  },
};

const createBaseContext = (overrides: Record<string, unknown> = {}) =>
  mergeRecord(baseContext, overrides);

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
        doubleTapGateFeatures: expect.objectContaining({
          patternGeometry: 'unknown',
          necklineBreakout: 'missing',
        }),
        deterministicQuality: 1,
        approvalAllowedNow: false,
      }),
    );
    expect(
      (result as any).additionalIndicators.baseContext.doubleTapGateFeatures,
    ).toMatchObject({
      patternGeometry: 'unknown',
      necklineBreakout: 'missing',
    });
  });

  it('approves high precision breakouts when CMC and baseContext support the gate', () => {
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

  it('downgrades legacy q4 CMC pockets to observation context', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext({
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
          }),
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 0.4,
          },
        },
      },
      analysis: {
        approved: false,
        quality: 1,
        direction: null,
      },
    } as any);

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('approves q4 derivatives reference pockets without requiring the strict ROC gate', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'SHORT',
            height: 10,
            breakoutDistancePct: 0.5,
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            regime: {
              session: {
                sessionPhase: 'us',
                sessionWindowPhase: 'closing',
              },
              trend: {
                bias: 'neutral',
              },
              momentum: {
                roc1d: -8,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'below_low_level',
              },
              levels: {
                lowTouchCount20: 0,
              },
            },
            relative: {
              cmcGlobal: {
                btcDominanceChange24hPct: 0.1,
              },
              cmcIndexes: {
                cmc20ToCmc100RatioChange24hPct: 0,
              },
              btcAltRegime: {
                btcVsAltReturn24h: -0.009,
              },
            },
            derivatives: {
              referenceContexts: {
                ETHUSDT: {
                  summary: {
                    crowdingPersistenceBars: 140,
                  },
                },
                SOLUSDT: {
                  intervals: {
                    '15m': {
                      fundingZScore: 0.2,
                    },
                  },
                },
              },
            },
            gateFeatures: {
              scores: {
                execution: 10,
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.deterministicQuality).toBe(4);
    expect(context.approvalAllowedNow).toBe(true);
    expect(context.strictMomentumApprovalAllowedNow).toBe(false);
    expect(context.strictMomentumBlockReasons).toEqual([]);
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'q4_derivatives',
      defaultApprovalAllowed: true,
      q4DerivativesPocket: true,
      q4DerivativesCmcRiskOk: true,
      q4DerivativesDirectionSessionOk: true,
      strictMomentumApproved: false,
      strictMomentumRoc1dOk: false,
    });
  });

  it('approves long q4 derivatives reference pockets during the Europe session', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 0.5,
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            regime: {
              session: {
                sessionPhase: 'europe',
              },
              momentum: {
                roc1d: -8,
              },
            },
            relative: {
              cmcIndexes: {
                cmc20ToCmc100RatioChange24hPct: 0,
              },
              btcAltRegime: {
                btcVsAltReturn24h: -0.009,
              },
            },
            derivatives: {
              referenceContexts: {
                ETHUSDT: {
                  summary: {
                    crowdingPersistenceBars: 140,
                  },
                },
                SOLUSDT: {
                  intervals: {
                    '15m': {
                      fundingZScore: 0.2,
                    },
                  },
                },
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.deterministicQuality).toBe(4);
    expect(context.approvalAllowedNow).toBe(true);
    expect(context.q4DerivativesDirectionSessionOk).toBe(true);
    expect(context.strictMomentumApprovalAllowedNow).toBe(false);
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'q4_derivatives',
      defaultApprovalAllowed: true,
      q4DerivativesPocket: true,
      q4DerivativesCmcRiskOk: true,
      q4DerivativesDirectionSessionOk: true,
      strictMomentumApproved: false,
      strictMomentumRoc1dOk: false,
    });
  });

  it('blocks long q4 derivatives reference pockets outside the Europe session', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 0.5,
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            regime: {
              session: {
                sessionPhase: 'off_hours',
              },
              momentum: {
                roc1d: -8,
              },
            },
            relative: {
              cmcIndexes: {
                cmc20ToCmc100RatioChange24hPct: 0,
              },
              btcAltRegime: {
                btcVsAltReturn24h: -0.009,
              },
            },
            derivatives: {
              referenceContexts: {
                ETHUSDT: {
                  summary: {
                    crowdingPersistenceBars: 140,
                  },
                },
                SOLUSDT: {
                  intervals: {
                    '15m': {
                      fundingZScore: 0.2,
                    },
                  },
                },
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.q4DerivativesDirectionSessionOk).toBe(false);
    expect(context.softBlockReasons).toContain(
      'long_q4_derivatives_outside_europe_session',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'q4_derivatives_blocked',
      defaultApprovalAllowed: false,
      q4DerivativesPocket: true,
      q4DerivativesCmcRiskOk: true,
      q4DerivativesDirectionSessionOk: false,
    });
  });

  it('blocks q4 derivatives reference pockets when SOL funding is above the gate', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            relative: {
              cmcGlobal: {
                btcDominanceChange24hPct: 0.1,
              },
              cmcIndexes: {
                cmc20ToCmc100RatioChange24hPct: 0,
              },
              btcAltRegime: {
                altDispersion24h: 0.12,
                btcVsAltReturn24h: -0.009,
              },
            },
            derivatives: {
              referenceContexts: {
                ETHUSDT: {
                  summary: {
                    crowdingPersistenceBars: 140,
                  },
                },
                SOLUSDT: {
                  intervals: {
                    '15m': {
                      fundingZScore: 0.21,
                    },
                  },
                },
              },
            },
          }),
          doubleTapContext: {
            signalDirection: 'SHORT',
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

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('blocks q4 derivatives reference pockets when SOL funding is missing', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'SHORT',
            height: 10,
            breakoutDistancePct: 0.5,
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            regime: {
              session: {
                sessionPhase: 'us',
                sessionWindowPhase: 'closing',
              },
              trend: {
                bias: 'neutral',
              },
              momentum: {
                roc1d: -8,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'below_low_level',
              },
              levels: {
                lowTouchCount20: 0,
              },
            },
            relative: {
              cmcGlobal: {
                btcDominanceChange24hPct: 0.1,
              },
              cmcIndexes: {
                cmc20ToCmc100RatioChange24hPct: 0,
              },
              btcAltRegime: {
                altDispersion24h: 0.12,
                btcVsAltReturn24h: -0.009,
              },
            },
            derivatives: {
              referenceContexts: {
                ETHUSDT: {
                  summary: {
                    crowdingPersistenceBars: 140,
                  },
                },
                SOLUSDT: {
                  intervals: {
                    '15m': {
                      fundingZScore: null,
                    },
                  },
                },
              },
            },
            gateFeatures: {
              scores: {
                execution: 10,
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.solFundingZScore15m).toBeNull();
    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'q4_blocked',
      defaultApprovalAllowed: false,
      q4DerivativesPocket: false,
    });
  });

  it('blocks q4 derivatives reference pockets in the CMC/BTC loss pocket', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'SHORT',
            height: 10,
            breakoutDistancePct: 0.5,
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            regime: {
              session: {
                sessionPhase: 'us',
                sessionWindowPhase: 'closing',
              },
              trend: {
                bias: 'neutral',
              },
              momentum: {
                roc1d: -8,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'below_low_level',
              },
            },
            relative: {
              cmcGlobal: {
                btcDominanceChange24hPct: 0.1,
              },
              cmcIndexes: {
                cmc20ToCmc100RatioChange24hPct: -0.0007,
              },
              btcAltRegime: {
                altDispersion24h: 0.12,
                btcVsAltReturn24h: -0.014,
              },
            },
            derivatives: {
              referenceContexts: {
                ETHUSDT: {
                  summary: {
                    crowdingPersistenceBars: 140,
                  },
                },
                SOLUSDT: {
                  intervals: {
                    '15m': {
                      fundingZScore: 0.2,
                    },
                  },
                },
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'q4_derivatives_blocked',
      defaultApprovalAllowed: false,
      q4DerivativesPocket: true,
      q4DerivativesCmcRiskOk: false,
    });
  });

  it('blocks q4 pockets when alt dispersion reaches the q4 gate', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            relative: {
              btcAltRegime: {
                altDispersion24h: 0.06,
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
        approved: false,
        quality: 1,
        direction: null,
      },
    } as any);

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('blocks q4 pockets when alt dispersion is missing', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 0.4,
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            relative: {
              btcAltRegime: {
                altDispersion24h: undefined,
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.softBlockReasons).toContain(
      'missing_alt_dispersion_24h_for_q4',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      defaultApprovalAllowed: false,
      q4AltDispersionOk: null,
    });
  });

  it('keeps q5 high precision pockets when alt dispersion is above the q4 gate', () => {
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
            relative: {
              btcAltRegime: {
                altDispersion24h: 0.12,
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

  it('marks strict momentum approval when approved pockets have ROC1D above the strict gate', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 0.6,
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            regime: {
              momentum: {
                roc1d: -5.25,
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.approvalAllowedNow).toBe(true);
    expect(context.strictMomentumApprovalAllowedNow).toBe(true);
    expect(context.strictMomentumBlockReasons).toEqual([]);
    expect(context.doubleTapGateFeatures).toMatchObject({
      defaultApprovalAllowed: true,
      approvalPocket: 'high_precision',
      q4AltDispersionOk: true,
      strictMomentumApproved: true,
      strictMomentumRoc1dOk: true,
    });
  });

  it('blocks main approval below the strict ROC1D gate', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 0.6,
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            regime: {
              momentum: {
                roc1d: -5.26,
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.approvalAllowedNow).toBe(false);
    expect(context.strictMomentumApprovalAllowedNow).toBe(false);
    expect(context.strictMomentumBlockReasons).toContain(
      'roc1d_below_strict_momentum_gate',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      defaultApprovalAllowed: true,
      approvalPocket: 'high_precision',
      strictMomentumApproved: false,
      strictMomentumRoc1dOk: false,
    });
  });

  it('blocks main approval when strict ROC1D is missing', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 0.6,
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            regime: {
              momentum: {
                roc1d: undefined,
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.approvalAllowedNow).toBe(false);
    expect(context.strictMomentumApprovalAllowedNow).toBe(false);
    expect(context.strictMomentumBlockReasons).toContain(
      'missing_roc1d_for_strict_momentum',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      defaultApprovalAllowed: true,
      approvalPocket: 'high_precision',
      strictMomentumApproved: false,
      strictMomentumRoc1dOk: null,
    });
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

  it('keeps legacy q4 CMC pockets downgraded with neutral venue spread', () => {
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

  it('keeps legacy q4 CMC pockets downgraded with negative venue spread', () => {
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

  it('keeps legacy q4 CMC pockets downgraded with non-neutral trend', () => {
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
                venueSpreadZScore: 1.5,
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

  it('keeps high precision pockets when volume is below the old strict threshold', () => {
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
            participation: {
              volume: {
                volumeRel20: 2.5,
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

  it('keeps high precision pockets when reward-to-volatility is below the old strict threshold', () => {
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
            gateFeatures: {
              setup: {
                rewardToVolatility: 7.9,
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

  it('downgrades high precision pockets when volume structure is not aligned', () => {
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
            gateFeatures: {
              participation: {
                volumeStructureAligned: false,
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

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('downgrades high precision pockets when benchmark conflict is present', () => {
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
            gateFeatures: {
              relative: {
                benchmarkConflict: true,
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

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('downgrades high precision pockets when CMC alt volume is too hot', () => {
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
            relative: {
              cmcGlobal: {
                altVolumeChange24hPct: 0.6,
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

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('downgrades high precision pockets outside the active session window', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            regime: {
              session: {
                sessionPhase: 'off_hours',
                sessionWindowPhase: 'closing',
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

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('downgrades q4 pockets when execution score is weak', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            gateFeatures: {
              scores: {
                execution: 34,
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
        approved: false,
        quality: 1,
        direction: null,
      },
    } as any);

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('downgrades q4 pockets when low touch count is below the gate', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            structure: {
              levels: {
                lowTouchCount20: 0,
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
        approved: false,
        quality: 1,
        direction: null,
      },
    } as any);

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('downgrades q4 pockets when BTC dominance change is outside the CMC band', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBaseContext({
            relative: {
              cmcGlobal: {
                btcDominanceChange24hPct: 0.1,
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
        approved: false,
        quality: 1,
        direction: null,
      },
    } as any);

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });
});
