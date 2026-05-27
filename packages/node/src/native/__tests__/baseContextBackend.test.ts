import { createIndicators } from '@tradejs/core/indicators';
import type { Candle } from '@tradejs/types';

import {
  createBaseContextBackend,
  resolveIndicatorBackendName,
} from '../baseContextBackend';

const INTERVAL_15M_MS = 15 * 60 * 1000;

const makeCandle = (index: number): Candle => {
  const wave = Math.sin(index / 7) * 2 + Math.cos(index / 19) * 4;
  const close = 100 + index * 0.05 + wave;
  const open = close - Math.sin(index / 5) * 0.7;
  const high = Math.max(open, close) + 0.6 + Math.abs(Math.sin(index / 3));
  const low = Math.min(open, close) - 0.6 - Math.abs(Math.cos(index / 4));
  const volume =
    1_000 + (index % 37) * 23 + Math.abs(Math.sin(index / 11)) * 250;

  return {
    timestamp: index * INTERVAL_15M_MS,
    open,
    high,
    low,
    close,
    volume,
    turnover: volume * close,
  };
};

const expectCloseOrNull = (
  actual: number | null | undefined,
  expected: number | null | undefined,
) => {
  if (expected == null) {
    expect(actual).toBeNull();
    return;
  }

  expect(actual).toBeCloseTo(expected, 8);
};

describe('baseContext native backend selector', () => {
  it('defaults to the TypeScript backend', () => {
    expect(resolveIndicatorBackendName(undefined)).toBe('ts');
    expect(resolveIndicatorBackendName('')).toBe('ts');
    expect(resolveIndicatorBackendName('typescript')).toBe('ts');
  });

  it('accepts rust/native aliases', () => {
    expect(resolveIndicatorBackendName('rust')).toBe('rust');
    expect(resolveIndicatorBackendName('native')).toBe('rust');
  });

  it('rejects unknown backend names', () => {
    expect(() => resolveIndicatorBackendName('python')).toThrow(
      'TRADEJS_INDICATOR_BACKEND must be "ts" or "rust"',
    );
  });

  it('matches the TypeScript baseContext for native overlay sections', () => {
    const previousBackend = process.env.TRADEJS_INDICATOR_BACKEND;
    process.env.TRADEJS_INDICATOR_BACKEND = 'rust';

    try {
      const rustBackend = createBaseContextBackend();
      expect(rustBackend).toBeDefined();

      const candles = Array.from({ length: 260 }, (_, index) =>
        makeCandle(index),
      );
      const tsIndicators = createIndicators([]);
      const rustIndicators = createIndicators([], [], {
        baseContextBackend: rustBackend,
      });

      candles.forEach((candle) => {
        tsIndicators.next(candle);
        rustIndicators.next(candle);
      });

      const tsContext = tsIndicators.snapshot().baseContext;
      const rustContext = rustIndicators.snapshot().baseContext;

      if (tsContext == null || rustContext == null) {
        throw new Error('Expected baseContext snapshots to be available');
      }

      expect(rustContext.participation.delta?.source).toBe(
        tsContext.participation.delta?.source,
      );
      expect(rustContext.structure.srZones?.levels.length).toBe(
        tsContext.structure.srZones?.levels.length,
      );
      expect(rustContext.structure.liquidityZones?.activeCount).toBe(
        tsContext.structure.liquidityZones?.activeCount,
      );
      expect(rustContext.structure.liquidityTails?.activeCount).toBe(
        tsContext.structure.liquidityTails?.activeCount,
      );
      expect(rustContext.regime.trend.trendFollow?.state).toBe(
        tsContext.regime.trend.trendFollow?.state,
      );
      expect(rustContext.regime.trend.adaptiveChannel?.regime).toBe(
        tsContext.regime.trend.adaptiveChannel?.regime,
      );
      expectCloseOrNull(
        rustContext.participation.volumeStructure?.pointOfControl,
        tsContext.participation.volumeStructure?.pointOfControl,
      );
      expectCloseOrNull(
        rustContext.regime.trend.adaptiveChannel?.centerline,
        tsContext.regime.trend.adaptiveChannel?.centerline,
      );
    } finally {
      if (previousBackend == null) {
        delete process.env.TRADEJS_INDICATOR_BACKEND;
      } else {
        process.env.TRADEJS_INDICATOR_BACKEND = previousBackend;
      }
    }
  });
});
