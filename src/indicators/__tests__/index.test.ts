import { ATR_PCT, MOM, smaAligned } from '../index';

describe('indicators index exports', () => {
  it('exports ATR_PCT, smaAligned and MOM', () => {
    expect(typeof ATR_PCT).toBe('function');
    expect(typeof smaAligned).toBe('function');
    expect(typeof MOM).toBe('function');
  });
});
