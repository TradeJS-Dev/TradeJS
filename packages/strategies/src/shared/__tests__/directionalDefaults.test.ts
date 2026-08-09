import { config as adaptiveMomentumRibbonConfig } from '../../AdaptiveMomentumRibbon/config';
import { config as adaptiveTrendChannelConfig } from '../../AdaptiveTrendChannel/config';
import { config as breakoutConfig } from '../../Breakout/config';
import { config as gridConfig } from '../../Grid/config';
import { config as headAndShouldersConfig } from '../../HeadAndShoulders/config';
import { config as liquidityTailsConfig } from '../../LiquidityTails/config';
import { config as marketFlushReversalConfig } from '../../MarketFlushReversal/config';
import { config as relativeRotationConfig } from '../../RelativeRotation/config';
import { config as reverseTrendLineConfig } from '../../ReverseTrendLine/config';
import { config as structureZonesConfig } from '../../StructureZones/config';
import { config as trendFollowConfig } from '../../TrendFollow/config';
import { config as trendShiftConfig } from '../../TrendShift/config';

describe('directional strategy defaults', () => {
  it('uses the selected weak-side detector thresholds by default', () => {
    expect(adaptiveMomentumRibbonConfig).toMatchObject({
      AMR_MIN_SIGNAL_OSC_ABS_LONG: 1.75,
      AMR_MIN_SIGNAL_OSC_ABS_SHORT: 1.25,
      LONG: { enable: true, minRiskRatio: 1 },
      SHORT: { enable: true, minRiskRatio: 1 },
    });
    expect(adaptiveTrendChannelConfig).toMatchObject({
      ADAPTIVE_TREND_CHANNEL_MIN_BREAKOUT_DISTANCE_ATR_LONG: 1.2,
      ADAPTIVE_TREND_CHANNEL_MIN_BREAKOUT_DISTANCE_ATR_SHORT: 0.9,
      LONG: { enable: true, minRiskRatio: 0.8 },
      SHORT: { enable: true, minRiskRatio: 0.8 },
    });
    expect(breakoutConfig).toMatchObject({
      BREAKOUT_MIN_RANGE_ATR_LONG: 12,
      BREAKOUT_MIN_RANGE_ATR_SHORT: 20,
      BREAKOUT_RETEST_TOLERANCE_ATR_LONG: 0.1,
      BREAKOUT_RETEST_TOLERANCE_ATR_SHORT: 0.15,
    });
    expect(headAndShouldersConfig).toMatchObject({
      HEADSHOULDERS_TARGET_HEIGHT_PCT_LONG: 120,
      HEADSHOULDERS_TARGET_HEIGHT_PCT_SHORT: 100,
    });
    expect(liquidityTailsConfig).toMatchObject({
      LIQUIDITY_TAILS_MIN_WICK_RATIO_LONG: 3,
      LIQUIDITY_TAILS_MIN_WICK_RATIO_SHORT: 3,
      LIQUIDITY_TAILS_WICK_DOMINANCE_LONG: 2.2,
      LIQUIDITY_TAILS_WICK_DOMINANCE_SHORT: 3.5,
      LIQUIDITY_TAILS_MAX_RETEST_DISTANCE_PCT_LONG: 0.45,
      LIQUIDITY_TAILS_MAX_RETEST_DISTANCE_PCT_SHORT: 0.2,
      LONG: { enable: true, minRiskRatio: 1 },
      SHORT: { enable: true, minRiskRatio: 1 },
    });
    expect(reverseTrendLineConfig).toMatchObject({
      REVERSE_TRENDLINE_MIN_REJECTION_STRENGTH_PCT_LONG: 0.2,
      REVERSE_TRENDLINE_MIN_REJECTION_STRENGTH_PCT_SHORT: 0.1,
    });
  });

  it('uses the selected directional target and risk thresholds by default', () => {
    expect(gridConfig).toMatchObject({
      GRID_TAKE_PROFIT_STEP_MULT_LONG: 1.25,
      GRID_TAKE_PROFIT_STEP_MULT_SHORT: 1.1,
    });
    expect(relativeRotationConfig).toMatchObject({
      RR_MIN_RELATIVE_STRENGTH_1H_LONG: 4,
      RR_MIN_RELATIVE_STRENGTH_1H_SHORT: 8,
      RR_TARGET_R_MULT_LONG: 1.5,
      RR_TARGET_R_MULT_SHORT: 1.8,
    });
    expect(structureZonesConfig).toMatchObject({
      STRUCTURE_ZONES_MIN_REACTION_DISTANCE_ATR_LONG: 0.75,
      STRUCTURE_ZONES_MIN_REACTION_DISTANCE_ATR_SHORT: 0.5,
      STRUCTURE_ZONES_TARGET_R_MULT_LONG: 0.8,
      STRUCTURE_ZONES_TARGET_R_MULT_SHORT: 1.2,
      LONG: { enable: true, minRiskRatio: 0.7 },
      SHORT: { enable: true, minRiskRatio: 0.7 },
    });
    expect(trendFollowConfig).toMatchObject({
      TRENDFOLLOW_MIN_BREAKOUT_DISTANCE_PCT_LONG: 3,
      TRENDFOLLOW_MIN_BREAKOUT_DISTANCE_PCT_SHORT: 2,
      TRENDFOLLOW_TARGET_R_MULT_LONG: 1.4,
      TRENDFOLLOW_TARGET_R_MULT_SHORT: 1.2,
      LONG: { enable: true, minRiskRatio: 0.8 },
      SHORT: { enable: true, minRiskRatio: 0.8 },
    });
    expect(trendShiftConfig).toMatchObject({
      TRENDSHIFT_TARGET_R_MULT_LONG: 1.2,
      TRENDSHIFT_TARGET_R_MULT_SHORT: 1,
      LONG: { enable: true, minRiskRatio: 1 },
      SHORT: { enable: true, minRiskRatio: 0.8 },
    });
  });

  it('uses replay-safe directional confirmation for market flush reversal', () => {
    expect(marketFlushReversalConfig).toMatchObject({
      MFR_REQUIRE_CALIBRATED_LONG_REBOUND_POCKET: false,
      MFR_ENTRY_MODE: 'confirmation',
      MFR_CONFIRMATION_BARS_LONG: 4,
      MFR_CONFIRMATION_BARS_SHORT: 3,
      MFR_PENDING_MAX_BARS: 4,
      MFR_REQUIRE_DIRECTIONAL_CONFIRMATION_BODY: true,
      MFR_MIN_REJECTION_CLOSE_POSITION_LONG: 0.6,
      MFR_MIN_REJECTION_CLOSE_POSITION_SHORT: 0.7,
      MFR_MIN_REJECTION_BODY_ATR_LONG: 0.8,
      MFR_MIN_REJECTION_BODY_ATR_SHORT: 0.6,
      LONG: { enable: true, minRiskRatio: 1.2 },
      SHORT: { enable: true, minRiskRatio: 1.2 },
    });
  });
});
