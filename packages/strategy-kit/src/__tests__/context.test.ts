/** @jest-environment node */

import type {
  BaseStrategyContextSnapshot,
  IndicatorsHistorySnapshot,
} from '@tradejs/types';
import {
  getAverageTurnover20,
  getIndicatorsBaseContext,
  getSignalBaseContext,
} from '../context';

const baseContext = {
  candle: { turnover: 1_000 },
  participation: { volume: { turnoverRel20: 2 } },
} as BaseStrategyContextSnapshot;

describe('base context helpers', () => {
  it('reads the canonical baseContext transport from signals and indicators', () => {
    expect(
      getSignalBaseContext({ additionalIndicators: { baseContext } }),
    ).toBe(baseContext);
    expect(
      getIndicatorsBaseContext({ baseContext } as IndicatorsHistorySnapshot),
    ).toBe(baseContext);
  });

  it('rejects non-record transports and invalid relative turnover', () => {
    expect(
      getSignalBaseContext({ additionalIndicators: undefined }),
    ).toBeNull();
    expect(getIndicatorsBaseContext(undefined)).toBeNull();
    expect(getAverageTurnover20(baseContext)).toBe(500);
    expect(
      getAverageTurnover20({
        ...baseContext,
        participation: { volume: { turnoverRel20: 0 } },
      } as BaseStrategyContextSnapshot),
    ).toBeNull();
  });
});
