import { createTestSuite, generateName, mergeConfigs } from '@utils/grid';
import { getTimestamp } from '@utils/timestamp';
import { uuid } from '@utils/uuid';

jest.mock('@utils/timestamp', () => ({
  getTimestamp: jest.fn(),
}));

jest.mock('@utils/uuid', () => ({
  uuid: jest.fn(),
}));

const mockedGetTimestamp = getTimestamp as jest.MockedFunction<
  typeof getTimestamp
>;
const mockedUuid = uuid as jest.MockedFunction<typeof uuid>;

describe('grid helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generateName returns prefix with generated id', () => {
    mockedUuid.mockReturnValue('abc123');

    expect(generateName('trend')).toBe('trend_abc123');
    expect(mockedUuid).toHaveBeenCalledWith(6);
  });

  it('mergeConfigs deduplicates values, sorts numeric params and clones objects', () => {
    const configA = {
      threshold: 2,
      mode: 'fast',
      levels: [{ p: 0.1, r: 0.5 }],
    };
    const configB = {
      threshold: 1,
      mode: 'fast',
      levels: [{ p: 0.1, r: 0.5 }],
    };
    const configC = {
      threshold: 3,
      mode: 'slow',
      levels: [{ p: 0.2, r: 0.5 }],
    };

    const merged = mergeConfigs([
      configA as any,
      configB as any,
      configC as any,
    ]);

    expect(merged.threshold).toEqual([1, 2, 3]);
    expect(merged.mode).toEqual(['fast', 'slow']);
    expect(merged.levels).toHaveLength(2);

    (configA.levels[0] as any).p = 9.9;
    const firstMergedLevels = (merged.levels?.[0] as Array<{ p: number }>)[0];
    expect(firstMergedLevels.p).toBe(0.1);
  });

  it('createTestSuite expands symbols x param grid with deterministic ids and window', () => {
    mockedGetTimestamp
      .mockReturnValueOnce(1_700_000_000_000)
      .mockReturnValueOnce(1_700_000_100_000);

    mockedUuid
      .mockReturnValueOnce('suite01')
      .mockReturnValueOnce('test01')
      .mockReturnValueOnce('test02')
      .mockReturnValueOnce('test03')
      .mockReturnValueOnce('test04');

    const suite = createTestSuite(
      'alice',
      ['BTCUSDT', 'ETHUSDT'],
      'TrendLine',
      {
        MA_FAST: [10, 20],
      } as any,
      'ByBit' as any,
    );

    expect(suite).toHaveLength(4);
    expect(suite[0]).toEqual(
      expect.objectContaining({
        userName: 'alice',
        symbol: 'BTCUSDT',
        strategyName: 'TrendLine',
        testSuiteId: 'suite01',
        testId: 'test01',
        name: 'BTCUSDT_suite01_test01',
        options: {
          start: 1_700_000_000_000,
          end: 1_700_000_100_000,
        },
        strategyConfig: { MA_FAST: 10 },
        connectorName: 'ByBit',
      }),
    );

    expect(suite[1]?.strategyConfig).toEqual({ MA_FAST: 20 });
    expect(suite[2]?.symbol).toBe('ETHUSDT');
    expect(new Set(suite.map((item) => item.testSuiteId))).toEqual(
      new Set(['suite01']),
    );
    expect(new Set(suite.map((item) => item.testId))).toEqual(
      new Set(['test01', 'test02', 'test03', 'test04']),
    );
  });
});
