import type { Connector, TopOfBookTicker } from '@tradejs/types';
import { createEntrySubmissionValidation } from '../entrySubmissionValidation';

const quote = (price: number, timestamp = Date.now()): TopOfBookTicker => ({
  symbol: 'NMRUSDT',
  bidPrice: price - 0.001,
  askPrice: price,
  bidQty: 10,
  askQty: 10,
  timestamp,
});
const makeConnector = (): Connector => ({
  capabilities: {
    supportedUniverses: ['crypto'],
    defaultUniverse: 'crypto',
    orderSubmissionValidation: true,
  },
  universe: 'crypto',
  listInstruments: async () => [],
  kline: async () => [],
  getState: async () => ({}),
  setState: async () => {},
  getPosition: async () => null,
  getPositions: async () => [],
  placeOrder: async () => true,
  setTakeProfits: async () => true,
  setStopLoss: async () => true,
  closePosition: async () => true,
  getTickers: async () => [],
  getTopOfBookTicker: jest.fn(async () => quote(9.729)),
});
const params = (connector: Connector) => ({
  connector,
  symbol: 'NMRUSDT',
  direction: 'LONG' as const,
  takeProfits: [{ rate: 1, price: 10.5849 }],
  stopLossPrice: 9.222,
  limits: {
    minimumNetRiskRatio: 1.55,
    maxLossValue: 1,
    feeRate: 0.001,
    slippageBps: 0,
  },
});

describe('final submission validation', () => {
  it('reads a new quote when invoked after connector preparation', async () => {
    const connector = makeConnector();
    const getQuote = jest.fn(async () => quote(9.729));
    connector.getTopOfBookTicker = getQuote;
    const validate = createEntrySubmissionValidation(params(connector));
    expect(getQuote).not.toHaveBeenCalled();
    getQuote.mockResolvedValue(quote(9.763));
    await expect(validate?.({ qty: 1.9 })).rejects.toThrow(
      'ENTRY_RR_BELOW_MIN_AT_SUBMISSION',
    );
    expect(getQuote).toHaveBeenCalledTimes(1);
  });
  it.each([null, quote(9.729, Date.now() - 60_000)])(
    'rejects missing or stale quotes',
    async (value) => {
      const connector = makeConnector();
      connector.getTopOfBookTicker = async () => value;
      const validate = createEntrySubmissionValidation(params(connector));
      await expect(validate?.({ qty: 1.9 })).rejects.toThrow(
        value
          ? 'ENTRY_QUOTE_STALE_AT_SUBMISSION'
          : 'ENTRY_QUOTE_UNAVAILABLE_AT_SUBMISSION',
      );
    },
  );
  it('rejects an undated quote instead of treating it as fresh', async () => {
    const connector = makeConnector();
    connector.getTopOfBookTicker = async () => ({
      ...quote(9.729),
      timestamp: null,
    });
    const validate = createEntrySubmissionValidation(params(connector));
    await expect(validate?.({ qty: 1.9 })).rejects.toThrow(
      'ENTRY_QUOTE_UNAVAILABLE_AT_SUBMISSION',
    );
  });

  it('uses normalized quantity for the risk budget', async () => {
    const connector = makeConnector();
    const onValidated = jest.fn();
    const validate = createEntrySubmissionValidation({
      ...params(connector),
      onValidated,
    });
    await expect(validate?.({ qty: 1.9 })).resolves.toBeUndefined();
    expect(onValidated).toHaveBeenCalledWith(
      expect.objectContaining({ ask: 9.729 }),
      expect.objectContaining({
        plannedLossValue: expect.any(Number),
        netRiskRatio: expect.any(Number),
      }),
    );
    expect(onValidated.mock.calls[0][1].plannedLossValue).toBeLessThanOrEqual(
      1,
    );
    await expect(validate?.({ qty: 2 })).resolves.toBeUndefined();
    expect(onValidated).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ riskExceeded: true }),
    );
  });
  it('requires the connector to honor the final validation contract', () => {
    const connector = makeConnector();
    connector.capabilities.orderSubmissionValidation = false;
    expect(() => createEntrySubmissionValidation(params(connector))).toThrow(
      'ENTRY_SUBMISSION_VALIDATION_UNSUPPORTED',
    );
  });
  it('checks modeled execution prices in simulation without a network quote', async () => {
    const connector = Object.assign(makeConnector(), {
      __tradejsTestConnector: true,
    });
    const validate = createEntrySubmissionValidation(params(connector));
    await expect(
      validate?.({ qty: 1.9, executionPrice: 9.763 }),
    ).rejects.toThrow('ENTRY_RR_BELOW_MIN_AT_SUBMISSION');
    expect(connector.getTopOfBookTicker).not.toHaveBeenCalled();
  });
  it('uses bid for SHORT and protects profitable direction geometry', async () => {
    const connector = makeConnector();
    connector.getTopOfBookTicker = async () => ({
      ...quote(100.1),
      bidPrice: 100,
      askPrice: 100.1,
    });
    const validate = createEntrySubmissionValidation({
      ...params(connector),
      direction: 'SHORT',
      takeProfits: [{ rate: 1, price: 80 }],
      stopLossPrice: 105,
    });
    await expect(validate?.({ qty: 0.1 })).resolves.toBeUndefined();
  });
});
