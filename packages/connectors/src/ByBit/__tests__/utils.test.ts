/** @jest-environment node */

import { RestClientV5 } from 'bybit-api';
import {
  getSymbolMeta,
  mapPositionData,
  normalizeEntryQty,
  normalizeQty,
} from '../utils';

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

describe('Bybit instrument metadata', () => {
  const fixture = () => {
    const getInstrumentsInfo = jest.fn(async () => ({
      retCode: 0,
      result: {
        list: [
          {
            symbol: 'BTCUSDT',
            priceFilter: { tickSize: '0.1' },
            lotSizeFilter: {
              qtyStep: '0.001',
              minOrderQty: '0.001',
              maxOrderQty: '10000',
              maxMktOrderQty: '5000',
            },
            leverageFilter: {
              minLeverage: '1',
              maxLeverage: '20',
              leverageStep: '0.01',
            },
          },
        ],
      },
    }));
    const client = Object.assign(
      new RestClientV5({ syncTimeBeforePrivateRequests: false }),
      { getInstrumentsInfo },
    );
    return { client, getInstrumentsInfo };
  };

  it('parses all leverage constraints and refreshes cached instrument data on demand', async () => {
    const { client, getInstrumentsInfo } = fixture();
    await expect(getSymbolMeta(client, 'BTCUSDT')).resolves.toMatchObject({
      minLeverage: 1,
      maxLeverage: 20,
      maxMarketOrderQty: 5000,
      maxLimitOrderQty: 10000,
      leverageStep: 0.01,
    });
    await getSymbolMeta(client, 'BTCUSDT');
    expect(getInstrumentsInfo).toHaveBeenCalledTimes(1);
    await getSymbolMeta(client, 'BTCUSDT', true);
    expect(getInstrumentsInfo).toHaveBeenCalledTimes(2);
  });

  it('isolates API environments and expires cached limits after one minute', async () => {
    const first = fixture();
    const second = fixture();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      await getSymbolMeta(first.client, 'BTCUSDT');
      await getSymbolMeta(second.client, 'BTCUSDT');
      expect(second.getInstrumentsInfo).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(61_001);
      await getSymbolMeta(first.client, 'BTCUSDT');
      expect(first.getInstrumentsInfo).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects failed instrument responses', async () => {
    const { client, getInstrumentsInfo } = fixture();
    getInstrumentsInfo.mockResolvedValue({
      retCode: 10001,
      result: { list: [] },
    });
    await expect(getSymbolMeta(client, 'BTCUSDT')).rejects.toThrow(
      'No instrument info',
    );
  });
});

describe('Bybit entry quantity limits', () => {
  const meta = {
    tickSize: 0.1,
    qtyStep: 0.1,
    minOrderQty: 0.1,
    pricePrecision: 1,
    qtyPrecision: 1,
    maxMarketOrderQty: 5.07,
    maxLimitOrderQty: 10.07,
  };

  it.each([false, true])(
    'rounds down after capping to the maximum for this order type (limit=%s)',
    (isLimit) => {
      expect(normalizeEntryQty(48.265, meta, isLimit)).toEqual(
        isLimit ? { qtyNum: 10, qtyStr: '10.0' } : { qtyNum: 5, qtyStr: '5.0' },
      );
    },
  );

  it('never increases a request below the maximum and leaves protective normalization uncapped', () => {
    expect(normalizeEntryQty(1.25, meta, false)).toEqual({
      qtyNum: 1.2,
      qtyStr: '1.2',
    });
    expect(normalizeQty(48.2, meta)).toEqual({ qtyNum: 48.2, qtyStr: '48.2' });
  });

  it.each([undefined, null, 0, -1, NaN, Infinity])(
    'rejects an unavailable market maximum %s',
    (maxMarketOrderQty) => {
      expect(() =>
        normalizeEntryQty(1, { ...meta, maxMarketOrderQty }, false),
      ).toThrow('BYBIT_INVALID_ORDER_QTY_LIMIT');
    },
  );

  it.each([0, -1, NaN, Infinity])(
    'rejects invalid requested quantity %s',
    (qty) => {
      expect(() => normalizeEntryQty(qty, meta, false)).toThrow(
        'BYBIT_INVALID_ORDER_QTY',
      );
    },
  );
});
