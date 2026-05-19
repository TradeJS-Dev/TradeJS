import { parseTestName } from '../tests';

describe('tests utils', () => {
  describe('parseTestName', () => {
    it('parses symbol, suite id and test id from canonical name', () => {
      expect(parseTestName('BTCUSDT_suiteA_test42')).toEqual({
        symbol: 'BTCUSDT',
        testSuiteId: 'suiteA',
        testId: 'test42',
      });
    });

    it('keeps missing parts as undefined when format is incomplete', () => {
      expect(parseTestName('BTCUSDT_suiteA')).toEqual({
        symbol: 'BTCUSDT',
        testSuiteId: 'suiteA',
        testId: undefined,
      });
    });
  });
});
