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
        {
          ...baseRow,
          profitableTrade: false,
          signalId: 's3',
          symbol: 'ETHUSDT',
          testName: 'ETHUSDT_suiteA_test03',
          configId: 'cfg123',
          timestamp: 1_700_000_200_000,
          profit: -2,
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
      [1_700_000_200_000, 113],
    ]);
    expect(snapshot.strategies[0]?.orders).toEqual([]);
    expect(
      snapshot.strategies[0]?.metrics.find((item) => item.id === 'pnl'),
    ).toEqual(
      expect.objectContaining({
        label: 'P&L',
        value: '+13.00',
      }),
    );
    expect(
      snapshot.strategies[0]?.metrics.find((item) => item.id === 'monthlyPnl'),
    ).toEqual(expect.objectContaining({ label: 'Monthly P&L' }));
    expect(
      snapshot.strategies[0]?.details?.find(
        (item) => item.id === 'direction:LONG:approved',
      ),
    ).toEqual(
      expect.objectContaining({
        label: 'LONG approved',
        value: '3',
      }),
    );
    expect(
      snapshot.strategies[0]?.details?.find(
        (item) => item.id === 'direction:LONG:pnl',
      ),
    ).toEqual(
      expect.objectContaining({
        label: 'LONG pnl',
        value: '+13.00',
      }),
    );
    expect(
      snapshot.strategies[0]?.details?.find(
        (item) => item.id === 'maxLossStreak',
      ),
    ).toEqual(
      expect.objectContaining({
        label: 'max_loss_streak',
        value: '1',
      }),
    );
    expect(
      snapshot.strategies[0]?.details?.find(
        (item) => item.id === 'symbol:BTCUSDT:pnl',
      ),
    ).toEqual(
      expect.objectContaining({
        label: 'BTCUSDT pnl',
        value: '+10.00',
      }),
    );
    expect(
      snapshot.strategies[0]?.details?.find(
        (item) => item.id === 'symbol:ETHUSDT:pnl',
      ),
    ).toEqual(
      expect.objectContaining({
        label: 'ETHUSDT pnl',
        value: '+3.00',
      }),
    );
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

  it('adds detailed orders when approved rows include trade results', () => {
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
          timestamp: 1_700_000_100_000,
          profit: 9.25,
          tradeResult: {
            signalId: 's1',
            direction: 'LONG',
            qty: 0.5,
            closedQty: 0.5,
            entryTimestamp: 1_700_000_000_000,
            exitTimestamp: 1_700_000_100_000,
            exitReason: 'take_profit',
            requestedEntryPrice: 100,
            entryPrice: 100.1,
            requestedExitPrice: 120,
            exitPrice: 119.9,
            grossProfit: 10,
            netProfit: 9.25,
            openFee: 0.03,
            closeFee: 0.04,
            fundingFee: -0.01,
            totalFee: 0.06,
            entrySlippagePrice: 0.1,
            entrySlippageBps: 10,
            entrySlippageCost: 0.05,
            exitSlippagePrice: -0.1,
            exitSlippageBps: -8.33,
            exitSlippageCost: 0.05,
            totalSlippageCost: 0.1,
          },
        },
      ],
    });

    expect(snapshot.strategies[0]?.orders).toEqual([
      expect.objectContaining({
        id: 's1:1700000100000',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        exitReason: 'take_profit',
        pnl: 9.25,
        equityBefore: 100,
        equityAfter: 109.25,
        qty: 0.5,
        notional: 50.05,
        entryPrice: 100.1,
        exitPrice: 119.9,
        totalFee: 0.06,
      }),
    ]);
  });
});
