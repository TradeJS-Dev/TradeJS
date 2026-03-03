import { ATR_PCT, MOM, createSpreadSmoother, smaAligned } from '../index';

describe('indicators index exports', () => {
  it('exports ATR_PCT, smaAligned, MOM and spread helpers', () => {
    expect(typeof ATR_PCT).toBe('function');
    expect(typeof smaAligned).toBe('function');
    expect(typeof MOM).toBe('function');
    expect(typeof createSpreadSmoother).toBe('function');
  });
});
