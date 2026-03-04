import {
  ATR_PCT,
  MOM,
  createSpreadSmoother,
  getPluginIndicatorCatalog,
  getPluginIndicatorRenderers,
  getRegisteredIndicatorEntries,
  registerIndicatorEntries,
  smaAligned,
} from '../index';

describe('indicators index exports', () => {
  it('exports base indicators, spread helpers and registry API', () => {
    expect(typeof ATR_PCT).toBe('function');
    expect(typeof smaAligned).toBe('function');
    expect(typeof MOM).toBe('function');
    expect(typeof createSpreadSmoother).toBe('function');
    expect(typeof registerIndicatorEntries).toBe('function');
    expect(typeof getRegisteredIndicatorEntries).toBe('function');
    expect(typeof getPluginIndicatorCatalog).toBe('function');
    expect(typeof getPluginIndicatorRenderers).toBe('function');
  });
});
