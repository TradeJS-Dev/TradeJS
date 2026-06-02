import { config as DEFAULT_CONFIG } from '../config';
import {
  createAdaptiveMomentumRibbonEngine,
  evaluateAdaptiveMomentumRibbon,
} from '../engine';

const makeCandle = (timestamp: number, close: number) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: close - 0.2,
  close,
  high: close + 0.8,
  low: close - 0.8,
  volume: 1_000,
  turnover: close * 1_000,
});

const makeCandles = () => {
  const start = 1_700_000_000_000;
  return Array.from({ length: 80 }, (_, index) => {
    const wave = Math.sin(index / 4) * 3;
    const trend = index * 0.04;
    return makeCandle(start + index * 900_000, 100 + trend + wave);
  });
};

describe('createAdaptiveMomentumRibbonEngine', () => {
  it('rebuilds runtime state from initialCandles like a full evaluation pass', () => {
    const candles = makeCandles();
    const config = {
      ...DEFAULT_CONFIG,
      AMR_MOMENTUM_PERIOD: 8,
      AMR_BUTTERWORTH_SMOOTHING: 3,
      AMR_KC_LENGTH: 8,
      AMR_ATR_LENGTH: 5,
      AMR_MIN_SIGNAL_OSC_ABS: 0.1,
      AMR_REQUIRE_KC_BIAS: false,
      AMR_CONFIRM_ON_NEXT_BAR: true,
      AMR_WAIT_CLOSE: true,
      AMR_MIN_BARS_BETWEEN_SIGNALS: 2,
    } as any;
    const linePlots = [
      'signalOsc',
      'kcMidline',
      'kcUpper',
      'kcLower',
      'invalidationLevel',
    ];

    const fullEvaluation = evaluateAdaptiveMomentumRibbon({
      candles,
      config,
      linePlots,
    });
    const engine = createAdaptiveMomentumRibbonEngine({
      config,
      linePlots,
      initialCandles: candles.slice(0, -1),
    });
    const runtimeEvaluation = engine.next(candles[candles.length - 1]);

    expect(runtimeEvaluation).toEqual(fullEvaluation);
  });
});
