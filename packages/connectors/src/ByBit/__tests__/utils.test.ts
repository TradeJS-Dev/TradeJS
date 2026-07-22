/** @jest-environment node */

import { mapPositionData } from '../utils';

describe('ByBit position mapping', () => {
  it('maps aggregate position direction, average price and exchange protection', () => {
    expect(
      mapPositionData([
        {
          symbol: 'BTCUSDT',
          side: 'Buy',
          size: '2.5',
          avgPrice: '101.25',
          stopLoss: '95.5',
          takeProfit: '112.75',
        },
        {
          symbol: 'ETHUSDT',
          side: 'Sell',
          size: '3',
          avgPrice: '2000',
          stopLoss: '2100',
          takeProfit: '1800',
        },
        {
          symbol: 'XRPUSDT',
          side: 'Buy',
          size: '0',
          avgPrice: '1',
          stopLoss: '0.9',
          takeProfit: '1.1',
        },
      ] as any),
    ).toEqual([
      {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 2.5,
        price: 101.25,
        slPrice: 95.5,
        tpPrice: 112.75,
      },
      {
        symbol: 'ETHUSDT',
        direction: 'SHORT',
        qty: 3,
        price: 2000,
        slPrice: 2100,
        tpPrice: 1800,
      },
    ]);
  });

  it('returns an empty list for missing position data', () => {
    expect(mapPositionData(undefined as any)).toEqual([]);
  });
});
