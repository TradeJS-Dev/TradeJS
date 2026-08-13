import type { StrategyChartSnapshot } from '@tradejs/types';
import type { RuntimeStrategyView } from '#app/lib/runtimeStrategyContracts';
import { buildStrategySnapshotCardViewModel } from '../StrategySnapshotCard.presenter';
import { buildRuntimeStrategyCardViewModel } from '../RuntimeStrategyCard.presenter';

describe('strategy card presenters', () => {
  it('projects snapshot labels, rankings, and orders through one interface', () => {
    const snapshot: StrategyChartSnapshot = {
      cardId: 'card-1',
      generatedAt: 2,
      strategyName: 'TrendLine',
      title: 'TrendLine q3+',
      subtitle: 'q3+ · validation',
      datasetId: 'dataset-1',
      symbols: ['BTCUSDT', 'ETHUSDT'],
      orderLog: [
        [1, 100],
        [2, 110],
      ],
      orders: [
        {
          id: 'order-1',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          entryTimestamp: 1,
          exitTimestamp: 2,
          pnl: 10,
        },
      ],
      metrics: [],
      details: [
        { id: 'symbol:BTCUSDT:pnl', label: 'P&L', value: '10' },
        { id: 'symbol:BTCUSDT:orders', label: 'Orders', value: '1' },
      ],
    };

    const viewModel = buildStrategySnapshotCardViewModel(snapshot, 'ai');

    expect(viewModel.sourceLabel).toBe('dataset:');
    expect(viewModel.displaySubtitle).toBe('validation');
    expect(viewModel.snapshotOrders).toHaveLength(1);
    expect(viewModel.topSymbolPnlRanking[0]).toMatchObject({
      symbol: 'BTCUSDT',
      pnl: 10,
    });
  });

  it('projects runtime orders and rankings through one interface', () => {
    const strategy = {
      recentTrades: [],
      orders: [
        {
          orderId: 'runtime--1',
          symbol: 'ETHUSDT',
          direction: 'SHORT',
          status: 'closed',
          qty: 1,
          entryTimestamp: 1,
          entryPrice: 100,
          actualEntryPrice: 100,
          exitTimestamp: 2,
          exitPrice: 90,
          actualExitPrice: 90,
          currentPrice: 90,
          pnl: 10,
          durationHours: 1,
          entrySlippagePercent: 0,
          exitSlippagePercent: 0,
          exitType: 'tp',
          takeProfitPrice: 90,
          stopLossPrice: 110,
          takeProfitPercent: 10,
          stopLossPercent: 10,
          openFee: 0,
          closeFee: 0,
          fundingFee: 0,
          totalFee: 0,
          lastSyncedAt: 2,
        },
      ],
      orderLog: [
        [1, 100],
        [2, 110],
      ],
      stat: {},
      summary: { activeTrades: 0 },
    } as unknown as RuntimeStrategyView;

    const viewModel = buildRuntimeStrategyCardViewModel(strategy);

    expect(viewModel.runtimeOrders).toHaveLength(1);
    expect(viewModel.topSymbolPnlRanking[0]).toMatchObject({
      symbol: 'ETHUSDT',
      pnl: 10,
    });
    expect(
      viewModel.directionStats.find(({ direction }) => direction === 'SHORT'),
    ).toMatchObject({
      direction: 'SHORT',
      orders: 1,
    });
  });
});
