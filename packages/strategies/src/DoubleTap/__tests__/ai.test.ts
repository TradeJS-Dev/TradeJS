import {
  buildDoubleTapSetupFeatures,
  doubleTapAiAdapter,
} from '../adapters/ai';

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
      relativeStrength4h: 0,
    },
    execution: {
      venueSpreadZScore: 1.5,
    },
    cmcGlobal: {
      altVolumeChange24hPct: 0.2,
      btcDominanceChange24hPct: -0.1,
      ethDominanceChange24hPct: 0,
    },
    cmcReferenceAssets: {
      ethVsBtcVolumeRatio: 0.5,
    },
    marketBreadths: {
      top5: {
        dispersion: 0.01,
      },
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
    referenceContexts: {
      BNBUSDT: {
        summary: {
          pressure: 'neutral',
        },
      },
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
      cmcExchangeLiquidityVolumeChange24hPct: 0,
    },
  },
};

const createBaseContext = (overrides: Record<string, unknown> = {}) =>
  mergeRecord(baseContext, overrides);

const createBnbOiRotationBaseContext = (
  overrides: Record<string, unknown> = {},
) =>
  createBaseContext(
    mergeRecord(
      {
        derivatives: {
          referenceContexts: {
            BNBUSDT: {
              intervals: {
                '15m': {
                  oiChangePct24h: 0.65,
                },
                '1h': {
                  oiChangePct1h: -0.28,
                },
              },
            },
          },
        },
      },
      overrides,
    ),
  );

const createXrpOiShortNoHtfBaseContext = (
  overrides: Record<string, unknown> = {},
) =>
  createBaseContext(
    mergeRecord(
      {
        regime: {
          trend: {
            bias: 'bear',
          },
        },
        structure: {
          swing: {
            bias: 'bear',
          },
          localRange: {
            breakoutState: 'below_low_level',
          },
        },
        relative: {
          benchmark: {
            trendAlignment: 'aligned_bear',
            bias: 'bear',
          },
        },
        derivatives: {
          referenceContexts: {
            XRPUSDT: {
              intervals: {
                '15m': {
                  oiChangePct1h: 0.32,
                },
              },
            },
          },
        },
        gateFeatures: {
          mtf: {
            higherTimeframeConflict: false,
          },
        },
      },
      overrides,
    ),
  );

const createEthVolumeBreadthBaseContext = (
  overrides: Record<string, unknown> = {},
) =>
  createBaseContext(
    mergeRecord(
      {
        relative: {
          cmcGlobal: {
            ethDominanceChange24hPct: -0.049,
          },
          cmcReferenceAssets: {
            ethVsBtcVolumeRatio: 0.39,
          },
          marketBreadths: {
            top5: {
              dispersion: 0.0007,
            },
          },
        },
      },
      overrides,
    ),
  );

describe('doubleTapAiAdapter', () => {
  it('builds normalized pattern geometry and pivot-path features', () => {
    const timestamp = 1_700_000_000_000;
    const intervalMs = 15 * 60_000;
    const features = buildDoubleTapSetupFeatures({
      context: {
        patternKind: 'double_bottom',
        signalDirection: 'LONG',
        neckline: 110,
        targetPrice: 130,
        stopLossPrice: 80,
        height: 20,
        currentPrice: 112,
        breakoutDistancePct: 1.8,
        pivots: [
          { timestamp: timestamp - 7 * intervalMs, value: 105, kind: 'high' },
          { timestamp: timestamp - 5 * intervalMs, value: 90, kind: 'low' },
          { timestamp: timestamp - 2 * intervalMs, value: 110, kind: 'high' },
          { timestamp: timestamp - intervalMs, value: 91, kind: 'low' },
        ],
      },
      interval: '15',
      signalTimestamp: timestamp,
    });

    expect(features.geometry.patternHeightPct).toBeCloseTo(18.181818, 6);
    expect(features.geometry.breakoutDistanceHeightRatio).toBe(0.1);
    expect(features.geometry.tapPriceDeviationPct).toBeCloseTo(1.104972, 6);
    expect(features.geometry.tapDeviationHeightRatio).toBe(0.05);
    expect(features.geometry.stopDistanceHeightRatio).toBe(1.6);
    expect(features.geometry.targetDistanceHeightRatio).toBe(0.9);
    expect(features.path).toMatchObject({
      leadInBars: 2,
      firstLegBars: 3,
      secondLegBars: 1,
      tapSpacingBars: 4,
      breakoutLagBars: 1,
      legDurationSymmetryRatio: 1 / 3,
      breakoutSpeedHeightRatioPerBar: 0.1,
    });
    expect(features.path.firstLegSlopePctPerBar).toBeCloseTo(7.407407, 6);
    expect(features.path.secondLegSlopePctPerBar).toBeCloseTo(17.272727, 6);
    expect(features.path.legSlopeSymmetryRatio).toBeCloseTo(0.42885, 5);
  });

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
          geometry: expect.any(Object),
          path: expect.any(Object),
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
      geometry: expect.any(Object),
      path: expect.any(Object),
    });
  });

  it('approves the BNB OI rotation pocket', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createBnbOiRotationBaseContext({
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

    expect(result?.quality).toBe(4);
    expect(result?.direction).toBe('LONG');
  });

  it('blocks BNB OI rotation when benchmark relative strength is above the protective gate', () => {
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
          baseContext: createBnbOiRotationBaseContext({
            relative: {
              benchmark: {
                relativeStrength4h: 7.7701,
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.protectiveApprovalContextAvailable).toBe(true);
    expect(context.protectiveApprovalContextOk).toBe(false);
    expect(context.softBlockReasons).toContain(
      'relative_strength_4h_above_protective_gate',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'bnb_oi_rotation_blocked',
      defaultApprovalAllowed: false,
      bnbOiRotationPocket: true,
      bnbOiRotationMomentumOk: true,
      protectiveApprovalContextAvailable: true,
      protectiveApprovalContextOk: false,
    });
  });

  it('blocks BNB OI rotation when CMC exchange liquidity change is below the protective gate', () => {
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
          baseContext: createBnbOiRotationBaseContext({
            gateFeatures: {
              relative: {
                cmcExchangeLiquidityVolumeChange24hPct: -0.378663,
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.protectiveApprovalContextAvailable).toBe(true);
    expect(context.protectiveApprovalContextOk).toBe(false);
    expect(context.softBlockReasons).toContain(
      'cmc_exchange_liquidity_change_below_protective_gate',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'bnb_oi_rotation_blocked',
      defaultApprovalAllowed: false,
      bnbOiRotationPocket: true,
      bnbOiRotationMomentumOk: true,
      protectiveApprovalContextAvailable: true,
      protectiveApprovalContextOk: false,
    });
  });

  it('blocks BNB OI rotation when BNB reference pressure is crowded long', () => {
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
          baseContext: createBnbOiRotationBaseContext({
            derivatives: {
              referenceContexts: {
                BNBUSDT: {
                  summary: {
                    pressure: 'crowded_long',
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
    expect(context.strictMomentumApprovalAllowedNow).toBe(false);
    expect(context.protectiveApprovalContextAvailable).toBe(true);
    expect(context.protectiveApprovalContextOk).toBe(false);
    expect(context.softBlockReasons).toContain(
      'bnb_reference_pressure_crowded_long_protective_gate',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'bnb_oi_rotation_blocked',
      defaultApprovalAllowed: false,
      highQualityCadencePocket: false,
      bnbOiRotationPocket: true,
      bnbOiRotationMomentumOk: true,
      protectiveApprovalContextAvailable: true,
      protectiveApprovalContextOk: false,
    });
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

  it('keeps old q4 derivatives reference pockets as observation without BNB rotation', () => {
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

    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.strictMomentumApprovalAllowedNow).toBe(false);
    expect(context.strictMomentumBlockReasons).toEqual([]);
    expect(context.softBlockReasons).toContain(
      'missing_bnb_oi_rotation_context',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'q4_derivatives_blocked',
      defaultApprovalAllowed: false,
      q4DerivativesPocket: true,
      q4DerivativesCmcRiskOk: true,
      q4DerivativesDirectionSessionOk: true,
      bnbOiRotationPocket: false,
      bnbOiRotationContextAvailable: false,
      strictMomentumApproved: false,
      strictMomentumRoc1dOk: false,
    });
  });

  it('keeps old long q4 derivatives reference pockets as observation during the Europe session', () => {
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

    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.q4DerivativesDirectionSessionOk).toBe(true);
    expect(context.strictMomentumApprovalAllowedNow).toBe(false);
    expect(context.softBlockReasons).toContain(
      'missing_bnb_oi_rotation_context',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'q4_derivatives_blocked',
      defaultApprovalAllowed: false,
      q4DerivativesPocket: true,
      q4DerivativesCmcRiskOk: true,
      q4DerivativesDirectionSessionOk: true,
      bnbOiRotationPocket: false,
      bnbOiRotationContextAvailable: false,
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

  it('downgrades legacy high precision pockets without BNB rotation', () => {
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

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('marks strict momentum diagnostics when BNB rotation is approved', () => {
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
          baseContext: createBnbOiRotationBaseContext({
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

    expect(context.deterministicQuality).toBe(4);
    expect(context.approvalAllowedNow).toBe(true);
    expect(context.strictMomentumApprovalAllowedNow).toBe(true);
    expect(context.strictMomentumBlockReasons).toEqual([]);
    expect(context.doubleTapGateFeatures).toMatchObject({
      defaultApprovalAllowed: true,
      approvalPocket: 'bnb_oi_rotation',
      bnbOiRotationPocket: true,
      bnbOiRotationContextAvailable: true,
      q4AltDispersionOk: true,
      strictMomentumApproved: true,
      strictMomentumRoc1dOk: true,
    });
  });

  it('blocks BNB rotation approval below the ROC1D gate', () => {
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
          baseContext: createBnbOiRotationBaseContext({
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

    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.strictMomentumApprovalAllowedNow).toBe(false);
    expect(context.strictMomentumBlockReasons).toEqual([]);
    expect(context.softBlockReasons).toContain(
      'bnb_oi_rotation_roc1d_below_gate',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      defaultApprovalAllowed: false,
      approvalPocket: 'bnb_oi_rotation_blocked',
      bnbOiRotationPocket: true,
      bnbOiRotationMomentumOk: false,
      strictMomentumApproved: false,
      strictMomentumRoc1dOk: false,
    });
  });

  it('blocks BNB rotation approval when ROC1D is missing', () => {
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
          baseContext: createBnbOiRotationBaseContext({
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

    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.strictMomentumApprovalAllowedNow).toBe(false);
    expect(context.strictMomentumBlockReasons).toEqual([]);
    expect(context.softBlockReasons).toContain(
      'missing_roc1d_for_bnb_oi_rotation',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      defaultApprovalAllowed: false,
      approvalPocket: 'bnb_oi_rotation_blocked',
      bnbOiRotationPocket: true,
      bnbOiRotationMomentumOk: false,
      strictMomentumApproved: false,
      strictMomentumRoc1dOk: null,
    });
  });

  it('blocks BNB rotation approval below the ETH/BTC volume ratio gate', () => {
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
          baseContext: createBnbOiRotationBaseContext({
            relative: {
              cmcReferenceAssets: {
                ethVsBtcVolumeRatio: 0.339,
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.strictMomentumApprovalAllowedNow).toBe(false);
    expect(context.ethVsBtcVolumeRatioApprovalOk).toBe(false);
    expect(context.softBlockReasons).toContain(
      'eth_vs_btc_volume_ratio_below_approval_gate',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      defaultApprovalAllowed: false,
      approvalPocket: 'bnb_oi_rotation_blocked',
      bnbOiRotationPocket: true,
      bnbOiRotationMomentumOk: true,
      ethVsBtcVolumeRatioApprovalOk: false,
      strictMomentumApproved: false,
    });
  });

  it('approves the XRP OI short pocket when HTF conflict is absent', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createXrpOiShortNoHtfBaseContext(),
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

    expect(result?.quality).toBe(4);
    expect(result?.direction).toBe('SHORT');
  });

  it('keeps the ETH volume/breadth compression pocket as observation without BNB/XRP confirmation', () => {
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
          baseContext: createEthVolumeBreadthBaseContext({
            relative: {
              benchmark: {
                relativeStrength4h: 12,
              },
            },
            derivatives: {
              referenceContexts: {
                BNBUSDT: {
                  summary: {
                    pressure: 'crowded_long',
                  },
                },
              },
            },
            gateFeatures: {
              relative: {
                cmcExchangeLiquidityVolumeChange24hPct: -1,
              },
            },
          }),
        },
      } as any,
    } as any);

    const context = (result as any).additionalIndicators.doubleTapContext;

    expect(context.deterministicQuality).toBe(3);
    expect(context.approvalAllowedNow).toBe(false);
    expect(context.ethVolumeBreadthContextAvailable).toBe(true);
    expect(context.ethVolumeBreadthCompressionPocket).toBe(true);
    expect(context.ethVsBtcVolumeRatioApprovalOk).toBe(true);
    expect(context.protectiveApprovalContextAvailable).toBe(true);
    expect(context.protectiveApprovalContextOk).toBe(false);
    expect(context.softBlockReasons).toContain(
      'eth_volume_breadth_observation_only',
    );
    expect(context.softBlockReasons).not.toContain(
      'bnb_reference_pressure_crowded_long_protective_gate',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'eth_volume_breadth_blocked',
      defaultApprovalAllowed: false,
      highQualityCadencePocket: false,
      bnbOiRotationPocket: false,
      xrpOiShortNoHtfPocket: false,
      ethVolumeBreadthContextAvailable: true,
      ethVolumeBreadthCompressionPocket: true,
      ethVsBtcVolumeRatioApprovalOk: true,
      protectiveApprovalContextAvailable: true,
      protectiveApprovalContextOk: false,
    });
  });

  it('blocks the ETH volume/breadth compression pocket at the ETH dominance boundary', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          baseContext: createEthVolumeBreadthBaseContext({
            relative: {
              cmcGlobal: {
                ethDominanceChange24hPct: -0.05,
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

  it('blocks the XRP OI short pocket when HTF conflict is present', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'SHORT',
            height: 10,
            breakoutDistancePct: 0.6,
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: createXrpOiShortNoHtfBaseContext({
            gateFeatures: {
              mtf: {
                higherTimeframeConflict: true,
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
      'xrp_oi_short_no_htf_higher_timeframe_conflict',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      approvalPocket: 'high_precision_blocked',
      defaultApprovalAllowed: false,
      xrpOiShortNoHtfPocket: false,
      xrpOiShortNoHtfContextAvailable: true,
    });
  });

  it('blocks the XRP OI pocket for long signals', () => {
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
          baseContext: createXrpOiShortNoHtfBaseContext({
            regime: {
              trend: {
                bias: 'bull',
              },
            },
            structure: {
              swing: {
                bias: 'bull',
              },
              localRange: {
                breakoutState: 'above_high_level',
              },
            },
            relative: {
              benchmark: {
                trendAlignment: 'aligned_bull',
                bias: 'bull',
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
      'xrp_oi_short_no_htf_requires_short_signal',
    );
    expect(context.doubleTapGateFeatures).toMatchObject({
      defaultApprovalAllowed: false,
      xrpOiShortNoHtfPocket: false,
      xrpOiShortNoHtfContextAvailable: true,
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

  it('downgrades legacy high precision pockets when volume is below the old strict threshold', () => {
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

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('downgrades legacy high precision pockets when reward-to-volatility is below the old strict threshold', () => {
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

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
  });

  it('downgrades legacy high precision pockets despite neutral venue spread', () => {
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

    expect(result?.quality).toBe(3);
    expect(result?.direction).toBeNull();
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
