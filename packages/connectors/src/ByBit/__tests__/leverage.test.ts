/** @jest-environment node */
import { RestClientV5 } from 'bybit-api';
import { prepareBybitLeverage, withBybitOrderLock } from '../leverage';

const fixture = () => {
  let leverage = '10';
  const position = {
    symbol: 'BTCUSDT',
    positionIdx: 0,
    side: 'Buy',
    size: '0',
    positionValue: '0',
    riskId: 1,
  };
  const tiers = [
    { id: 1, symbol: 'BTCUSDT', riskLimitValue: '1000', maxLeverage: '100' },
    { id: 2, symbol: 'BTCUSDT', riskLimitValue: '10000', maxLeverage: '10' },
  ];
  const filter = { minLeverage: '1', maxLeverage: '100', leverageStep: '0.01' };
  const api = {
    getInstrumentsInfo: jest.fn(async () => ({
      retCode: 0,
      result: {
        list: [
          {
            symbol: 'BTCUSDT',
            priceFilter: { tickSize: '0.1' },
            lotSizeFilter: { qtyStep: '0.001', minOrderQty: '0.001' },
            leverageFilter: filter,
          },
        ],
      },
    })),
    getPositionInfo: jest.fn(async () => ({
      retCode: 0,
      result: { list: [{ ...position, leverage }] },
    })),
    getActiveOrders: jest.fn(async () => ({
      retCode: 0,
      result: {
        list: [] as {
          symbol: string;
          reduceOnly: boolean;
          side: string;
          leavesQty: string;
          price: string;
        }[],
        nextPageCursor: '',
      },
    })),
    getRiskLimit: jest.fn(async () => ({
      retCode: 0,
      result: { list: tiers, nextPageCursor: '' },
    })),
    setLeverage: jest.fn(async ({ buyLeverage }: { buyLeverage: string }) => {
      leverage = buyLeverage;
      return { retCode: 0 };
    }),
  };
  const client = Object.assign(
    new RestClientV5({ syncTimeBeforePrivateRequests: false }),
    api,
  );
  const prepare = (requested = 20, qty = 1) =>
    prepareBybitLeverage({
      client,
      marketClient: client,
      symbol: 'BTCUSDT',
      requested,
      direction: 'LONG',
      qty,
      price: 100,
    });
  return { api, prepare, filter, position, tiers };
};

describe('Bybit leverage preparation', () => {
  it.each([
    ['100', 20, null],
    ['10', 10, 'instrument_limit'],
    ['5', 5, 'instrument_limit'],
  ] as const)(
    'requests 20x capped by instrument %s',
    async (max, effective, reason) => {
      const { prepare, api, filter } = fixture();
      filter.maxLeverage = max;
      await expect(prepare()).resolves.toMatchObject({
        requested: 20,
        effective,
        reductionReason: reason,
      });
      expect(api.setLeverage).toHaveBeenCalledWith({
        category: 'linear',
        symbol: 'BTCUSDT',
        buyLeverage: String(effective),
        sellLeverage: String(effective),
      });
    },
  );

  it('rounds down to the permitted leverage step', async () => {
    const { prepare, filter } = fixture();
    filter.leverageStep = '0.5';
    await expect(prepare(19.8)).resolves.toMatchObject({
      effective: 19.5,
      reductionReason: 'leverage_step',
    });
  });

  it('accounts for the resulting position and pending entry orders without changing quantity', async () => {
    const { prepare, api, position } = fixture();
    Object.assign(position, { size: '5', positionValue: '500' });
    api.getActiveOrders.mockResolvedValue({
      retCode: 0,
      result: {
        list: [
          {
            symbol: 'BTCUSDT',
            reduceOnly: false,
            side: 'Buy',
            leavesQty: '5',
            price: '100',
          },
          {
            symbol: 'BTCUSDT',
            reduceOnly: true,
            side: 'Sell',
            leavesQty: '100',
            price: '100',
          },
        ],
        nextPageCursor: '',
      },
    });
    await expect(prepare()).resolves.toMatchObject({
      effective: 10,
      reductionReason: 'risk_limit',
    });
  });

  it('respects the current position risk tier even for a small addition', async () => {
    const { prepare, position } = fixture();
    Object.assign(position, { size: '1', positionValue: '100', riskId: 2 });
    await expect(prepare()).resolves.toMatchObject({ effective: 10 });
  });

  it('accepts not-modified only when the exchange confirms the desired leverage', async () => {
    const { prepare, api } = fixture();
    api.setLeverage.mockResolvedValue({ retCode: 110043 });
    await expect(prepare(10)).resolves.toMatchObject({ effective: 10 });
    await expect(prepare(20)).rejects.toThrow('BYBIT_LEVERAGE_NOT_CONFIRMED');
  });

  it('refreshes instrument metadata and risk limits once after a known restriction', async () => {
    const { prepare, api, filter } = fixture();
    api.setLeverage.mockImplementationOnce(async () => {
      filter.maxLeverage = '5';
      return { retCode: 110013 };
    });
    await expect(prepare()).resolves.toMatchObject({ effective: 5 });
    expect(api.getInstrumentsInfo).toHaveBeenCalledTimes(2);
    expect(api.setLeverage).toHaveBeenCalledTimes(2);
  });

  it.each([110036, 110038, 10005, 110044])(
    'does not retry an unsupported mode or account failure %s',
    async (code) => {
      const { prepare, api } = fixture();
      api.setLeverage.mockResolvedValue({ retCode: code });
      await expect(prepare()).rejects.toThrow(`BYBIT_SET_LEVERAGE_${code}`);
      expect(api.setLeverage).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry a timeout with an unknown outcome', async () => {
    const { prepare, api } = fixture();
    api.setLeverage.mockRejectedValue(new Error('timeout'));
    await expect(prepare()).rejects.toThrow('timeout');
    expect(api.setLeverage).toHaveBeenCalledTimes(1);
  });

  it('bounds retries when risk limits remain incompatible', async () => {
    const { prepare, api } = fixture();
    api.setLeverage.mockResolvedValue({ retCode: 110086 });
    await expect(prepare()).rejects.toThrow('BYBIT_SET_LEVERAGE_110086');
    expect(api.setLeverage).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1, NaN, Infinity])(
    'rejects invalid requested leverage %s',
    async (value) => {
      const { prepare, api } = fixture();
      await expect(prepare(value)).rejects.toThrow(
        'BYBIT_INVALID_REQUESTED_LEVERAGE',
      );
      expect(api.setLeverage).not.toHaveBeenCalled();
    },
  );

  it('blocks missing instrument limits and unknown account state', async () => {
    const { prepare, filter, api } = fixture();
    filter.maxLeverage = '';
    await expect(prepare()).rejects.toThrow('BYBIT_INVALID_MAX_LEVERAGE');
    expect(api.setLeverage).not.toHaveBeenCalled();
  });

  it('blocks portfolio margin and hedge mode rather than changing account mode', async () => {
    const { prepare, api, position } = fixture();
    api.getPositionInfo.mockResolvedValueOnce({
      retCode: 0,
      result: { list: [{ ...position, leverage: '' }] },
    });
    await expect(prepare()).rejects.toThrow('BYBIT_INVALID_POSITION_LEVERAGE');
    position.positionIdx = 1;
    await expect(prepare()).rejects.toThrow(
      'BYBIT_LEVERAGE_POSITION_MODE_UNSUPPORTED',
    );
    expect(api.setLeverage).not.toHaveBeenCalled();
  });

  it('blocks exposure above every risk tier', async () => {
    const { prepare, api } = fixture();
    await expect(prepare(20, 200)).rejects.toThrow(
      'BYBIT_LEVERAGE_RISK_LIMIT_EXCEEDED',
    );
    expect(api.setLeverage).not.toHaveBeenCalled();
  });
});

describe('Bybit order serialization', () => {
  it('holds the account/symbol queue until submission finishes, releases on errors, and isolates accounts', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: string[] = [];
    const first = withBybitOrderLock('alice/BTCUSDT', async () => {
      events.push('first');
      await gate;
      throw new Error('rejected');
    });
    const failed = expect(first).rejects.toThrow('rejected');
    const second = withBybitOrderLock('alice/BTCUSDT', async () => {
      events.push('second');
    });
    await withBybitOrderLock('bob/BTCUSDT', async () => {
      events.push('other-account');
    });
    expect(events).toEqual(['first', 'other-account']);
    release();
    await Promise.all([failed, second]);
    expect(events).toEqual(['first', 'other-account', 'second']);
  });
});
