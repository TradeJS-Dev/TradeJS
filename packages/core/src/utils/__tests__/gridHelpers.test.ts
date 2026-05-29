import { createTestSuite, generateName, mergeConfigs } from '../grid';
import { getTimestamp } from '../timestamp';
import { uuid } from '../uuid';

jest.mock('../timestamp', () => ({
  getTimestamp: jest.fn(),
}));

jest.mock('../uuid', () => ({
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
        interval: '15',
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
    expect(suite[0]?.configId).toMatch(/^[a-z0-9]{6}$/);
    expect(suite[0]?.configId).toBe(suite[2]?.configId);
    expect(suite[1]?.configId).toBe(suite[3]?.configId);
    expect(suite[0]?.configId).not.toBe(suite[1]?.configId);
  });

  it('createTestSuite stores an explicit runtime interval on each test', () => {
    mockedGetTimestamp
      .mockReturnValueOnce(1_700_000_000_000)
      .mockReturnValueOnce(1_700_000_100_000);

    mockedUuid.mockReturnValueOnce('suite60').mockReturnValueOnce('test60');

    const suite = createTestSuite(
      'alice',
      ['BTCUSDT'],
      'TrendLine',
      {
        MA_FAST: [10],
      } as any,
      'ByBit' as any,
      '60' as any,
    );

    expect(suite).toHaveLength(1);
    expect(suite[0]).toEqual(
      expect.objectContaining({
        interval: '60',
        strategyConfig: { MA_FAST: 10 },
      }),
    );
  });

  it('assigns one shared configId per param combination for the AMR config grid', () => {
    mockedGetTimestamp
      .mockReturnValueOnce(1_700_000_000_000)
      .mockReturnValueOnce(1_700_000_100_000);

    mockedUuid
      .mockReturnValueOnce('suite02')
      .mockReturnValueOnce('test01')
      .mockReturnValueOnce('test02')
      .mockReturnValueOnce('test03')
      .mockReturnValueOnce('test04')
      .mockReturnValueOnce('test05')
      .mockReturnValueOnce('test06')
      .mockReturnValueOnce('test07')
      .mockReturnValueOnce('test08');

    const suite = createTestSuite(
      'alice',
      ['BTCUSDT', 'ETHUSDT'],
      'TrendShift',
      {
        AMR_MOMENTUM_PERIOD: [32, 48],
        AMR_LOOKBACK_BARS: [200],
        AMR_BUTTERWORTH_SMOOTHING: [4, 6],
        LONG: [
          {
            enable: true,
            direction: 'LONG',
            TP: 4.2,
            SL: 1.2,
          },
        ],
        SHORT: [
          {
            enable: false,
            direction: 'SHORT',
            TP: 3.8,
            SL: 1.2,
          },
        ],
      } as any,
      'ByBit' as any,
    );

    expect(suite).toHaveLength(8);
    expect(new Set(suite.map((item) => item.testId))).toEqual(
      new Set([
        'test01',
        'test02',
        'test03',
        'test04',
        'test05',
        'test06',
        'test07',
        'test08',
      ]),
    );

    const uniqueConfigIds = [...new Set(suite.map((item) => item.configId))];
    expect(uniqueConfigIds).toHaveLength(4);
    expect(
      uniqueConfigIds.every((configId) => /^[a-z0-9]{6}$/.test(configId || '')),
    ).toBe(true);

    const countsByConfigId = new Map<string, number>();
    for (const item of suite) {
      const configId = item.configId || '';
      countsByConfigId.set(configId, (countsByConfigId.get(configId) || 0) + 1);
    }

    expect([...countsByConfigId.values()]).toEqual([2, 2, 2, 2]);
  });

  it('scales AMR configId grouping correctly for 500 tickers', () => {
    mockedGetTimestamp
      .mockReturnValueOnce(1_700_000_000_000)
      .mockReturnValueOnce(1_700_000_100_000);

    mockedUuid.mockReturnValueOnce('suite500');
    for (let index = 1; index <= 2000; index += 1) {
      mockedUuid.mockReturnValueOnce(`t${String(index).padStart(5, '0')}`);
    }

    const tickers = Array.from(
      { length: 500 },
      (_, index) => `SYM${String(index + 1).padStart(3, '0')}USDT`,
    );

    const suite = createTestSuite(
      'alice',
      tickers,
      'TrendShift',
      {
        AMR_MOMENTUM_PERIOD: [32, 48],
        AMR_LOOKBACK_BARS: [200],
        AMR_BUTTERWORTH_SMOOTHING: [4, 6],
        LONG: [
          {
            enable: true,
            direction: 'LONG',
            TP: 4.2,
            SL: 1.2,
          },
        ],
        SHORT: [
          {
            enable: false,
            direction: 'SHORT',
            TP: 3.8,
            SL: 1.2,
          },
        ],
      } as any,
      'ByBit' as any,
    );

    expect(suite).toHaveLength(2000);
    expect(new Set(suite.map((item) => item.testId)).size).toBe(2000);

    const uniqueConfigIds = [...new Set(suite.map((item) => item.configId))];
    expect(uniqueConfigIds).toHaveLength(4);

    const countsByConfigId = new Map<string, number>();
    for (const item of suite) {
      const configId = item.configId || '';
      countsByConfigId.set(configId, (countsByConfigId.get(configId) || 0) + 1);
    }

    expect([...countsByConfigId.values()]).toEqual([500, 500, 500, 500]);
  });
});
