/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import {
  getVolumeDivergenceCoreFilterSkipCode,
  getVolumeDivergenceStrength,
} from '../filters';

describe('VolumeDivergence core filters', () => {
  it('calculates strength in the profitable direction for both sides', () => {
    expect(
      getVolumeDivergenceStrength({
        direction: 'LONG',
        currentVolumeNorm: 13,
        previousVolumeNorm: 10,
      }),
    ).toBe(3);
    expect(
      getVolumeDivergenceStrength({
        direction: 'SHORT',
        currentVolumeNorm: 10,
        previousVolumeNorm: 20,
      }),
    ).toBe(10);
  });

  it('uses independent maximum strength thresholds by direction', () => {
    expect(
      getVolumeDivergenceCoreFilterSkipCode({
        direction: 'LONG',
        currentVolumeNorm: 13.1,
        previousVolumeNorm: 10,
        config: DEFAULT_CONFIG as any,
      }),
    ).toBe('VOLUME_DIVERGENCE_STRENGTH_TOO_EXTREME');
    expect(
      getVolumeDivergenceCoreFilterSkipCode({
        direction: 'SHORT',
        currentVolumeNorm: 10,
        previousVolumeNorm: 20,
        config: DEFAULT_CONFIG as any,
      }),
    ).toBeNull();
  });
});
