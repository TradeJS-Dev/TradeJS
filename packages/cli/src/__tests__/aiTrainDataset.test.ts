import type { AiDatasetRow } from '@tradejs/types';
import { extractSignalFromAiDatasetRow } from '../lib/aiTrainDataset';

describe('aiTrainDataset', () => {
  it('restores the signal fields used by ai-train from a backtest AI dataset row', () => {
    const row = {
      signalId: 'sig-1',
      strategyName: 'TrendLine',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      timestamp: 1_700_000_000_000,
      profit: 12.5,
      payload: {
        signal: {
          signalId: 'sig-1',
          strategy: 'TrendLine',
          symbol: 'ETHUSDT',
          interval: '15',
          direction: 'LONG',
          timestamp: 1_700_000_000_000,
          prices: {
            currentPrice: 100,
            takeProfitPrice: 106,
            stopLossPrice: 98,
          },
        },
        figures: {
          trendline: {
            points: [
              { timestamp: 1, price: 90 },
              { timestamp: 2, price: 95 },
            ],
          },
        },
        indicators: {
          maFast: [98, 99, 100],
        },
        additionalIndicators: {
          baseContext: {
            participation: {
              tradeFlow: {
                source: 'binance_agg_trades',
                buyPressurePct: 0.64,
              },
            },
            relative: {
              execution: {
                venueSpread: 0.0012,
              },
            },
          },
        },
      },
    } as unknown as AiDatasetRow;

    expect(extractSignalFromAiDatasetRow(row)).toEqual({
      signalId: 'sig-1',
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      interval: '15',
      direction: 'LONG',
      timestamp: 1_700_000_000_000,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 106,
        stopLossPrice: 98,
      },
      figures: row.payload.figures,
      indicators: row.payload.indicators,
      additionalIndicators: row.payload.additionalIndicators,
    });
  });
});
