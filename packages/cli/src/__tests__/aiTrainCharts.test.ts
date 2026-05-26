import { buildAiChartSnapshot } from '../lib/aiTrainCharts';

describe('aiTrainCharts', () => {
  const baseRow = {
    profitableTrade: true,
    aiApproved: true,
    quality: 5,
    direction: 'LONG' as const,
    modelDirection: 'LONG',
    strategyName: 'trendshift',
  };

  it('aggregates different symbols into one card when configId is the same', () => {
    const snapshot = buildAiChartSnapshot({
      strategyName: 'trendshift',
      generatedAt: 1_700_000_000_000,
      runLabel: '',
      minQuality: 5,
      datasetId: '1779773352013',
      evaluatedRows: [
        {
          ...baseRow,
          signalId: 's1',
          symbol: 'BTCUSDT',
          testName: 'BTCUSDT_suiteA_test01',
          configId: 'cfg123',
          timestamp: 1_700_000_000_000,
          profit: 10,
        },
        {
          ...baseRow,
          signalId: 's2',
          symbol: 'ETHUSDT',
          testName: 'ETHUSDT_suiteA_test02',
          configId: 'cfg123',
          timestamp: 1_700_000_100_000,
          profit: 5,
        },
      ],
    });

    expect(snapshot.strategies).toHaveLength(1);
    expect(snapshot.strategies[0]).toEqual(
      expect.objectContaining({
        title: 'trendshift',
        subtitle: 'q5+',
        datasetId: '1779773352013',
        symbols: ['BTCUSDT', 'ETHUSDT'],
      }),
    );
    expect(snapshot.strategies[0]?.orderLog).toEqual([
      [1_700_000_000_000, 100],
      [1_700_000_000_000, 110],
      [1_700_000_100_000, 115],
    ]);
  });

  it('creates separate cards for different configIds', () => {
    const snapshot = buildAiChartSnapshot({
      strategyName: 'trendshift',
      generatedAt: 1_700_000_000_000,
      runLabel: '',
      minQuality: 5,
      evaluatedRows: [
        {
          ...baseRow,
          signalId: 's1',
          symbol: 'BTCUSDT',
          testName: 'BTCUSDT_suiteA_test01',
          configId: 'cfg123',
          timestamp: 1_700_000_000_000,
          profit: 10,
        },
        {
          ...baseRow,
          signalId: 's2',
          symbol: 'ETHUSDT',
          testName: 'ETHUSDT_suiteA_test02',
          configId: 'cfg999',
          timestamp: 1_700_000_100_000,
          profit: 5,
        },
      ],
    });

    expect(snapshot.strategies).toHaveLength(2);
    expect(snapshot.strategies.map((card) => card.title)).toEqual([
      'trendshift · config cfg123',
      'trendshift · config cfg999',
    ]);
  });

  it('creates cards only for the requested minQuality bucket', () => {
    const snapshot = buildAiChartSnapshot({
      strategyName: 'trendshift',
      generatedAt: 1_700_000_000_000,
      runLabel: 'llm:model',
      minQuality: 5,
      evaluatedRows: [
        {
          ...baseRow,
          signalId: 's1',
          symbol: 'BTCUSDT',
          testName: 'BTCUSDT_suiteA_test01',
          configId: 'cfg123',
          timestamp: 1_700_000_000_000,
          profit: 10,
        },
        {
          ...baseRow,
          signalId: 's2',
          symbol: 'ETHUSDT',
          testName: 'ETHUSDT_suiteA_test02',
          configId: 'cfg123',
          timestamp: 1_700_000_100_000,
          profit: -5,
        },
      ],
    });

    expect(snapshot.strategies).toHaveLength(1);
    expect(snapshot.strategies[0]?.subtitle).toBe('q5+ · llm:model');
    expect(
      snapshot.strategies[0]?.metrics.find((item) => item.id === 'maxDrawdown'),
    ).toEqual(
      expect.objectContaining({
        label: 'Max drawdown',
        value: '4.5%',
      }),
    );
    expect(
      snapshot.strategies[0]?.metrics.find((item) => item.id === 'quality'),
    ).toBeUndefined();
  });
});
