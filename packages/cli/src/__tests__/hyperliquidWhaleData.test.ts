import {
  aggregateHyperliquidWhaleEvents,
  classifyHyperliquidPositionChange,
  normalizeHyperliquidUserFill,
  normalizeHyperliquidWsTrade,
} from '../lib/hyperliquidWhaleData';

const identity = {
  universeFingerprint: 'universe-v1',
  whaleRegistryFingerprint: 'whales-v1',
};
const whaleA = '0x1111111111111111111111111111111111111111';
const whaleB = '0x2222222222222222222222222222222222222222';

describe('hyperliquidWhaleData', () => {
  it.each([
    [0, 'B', 2, 2, 'open'],
    [2, 'B', 1, 3, 'increase'],
    [2, 'A', 1, 1, 'reduce'],
    [2, 'A', 2, 0, 'close'],
    [2, 'A', 3, -1, 'flip'],
    [-2, 'B', 3, 1, 'flip'],
  ] as const)(
    'classifies position change start=%s side=%s size=%s as %s',
    (startPosition, side, size, endPosition, action) => {
      expect(
        classifyHyperliquidPositionChange({ startPosition, side, size }),
      ).toMatchObject({ endPosition, action });
    },
  );

  it('splits a position flip into closing and opening components', () => {
    expect(
      classifyHyperliquidPositionChange({
        startPosition: 2,
        side: 'A',
        size: 3,
      }),
    ).toMatchObject({
      action: 'flip',
      longExitSize: 2,
      shortEntrySize: 1,
      longEntrySize: 0,
      shortExitSize: 0,
    });
  });

  it('keeps only tracked symbols and whale-involved public trades', () => {
    const event = normalizeHyperliquidWsTrade({
      trade: {
        coin: 'BTC',
        px: '100',
        sz: '2',
        time: 120_001,
        tid: 7,
        users: [whaleA, whaleB],
      },
      trackedSymbols: new Set(['BTC']),
      trackedWhales: new Set([whaleA]),
      identity,
    });
    expect(event).toMatchObject({
      symbol: 'BTC',
      tid: '7',
      notionalUsd: 200,
      buyerTracked: true,
      sellerTracked: false,
    });
    expect(
      normalizeHyperliquidWsTrade({
        trade: { ...(event as any), coin: 'ETH', users: [whaleA, whaleB] },
        trackedSymbols: new Set(['BTC']),
        trackedWhales: new Set([whaleA]),
        identity,
      }),
    ).toBeNull();
  });

  it('merges buyer and seller history copies before aggregation', () => {
    const buyer = normalizeHyperliquidUserFill({
      fill: {
        coin: 'BTC',
        px: '100',
        sz: '2',
        time: 120_001,
        tid: 7,
        side: 'B',
        startPosition: '0',
        closedPnl: '0',
      },
      address: whaleA,
      trackedSymbols: new Set(['BTC']),
      identity,
    })!;
    const seller = normalizeHyperliquidUserFill({
      fill: {
        coin: 'BTC',
        px: '100',
        sz: '2',
        time: 120_001,
        tid: 7,
        side: 'A',
        startPosition: '0',
        closedPnl: '0',
      },
      address: whaleB,
      trackedSymbols: new Set(['BTC']),
      identity,
    })!;
    const rows = aggregateHyperliquidWhaleEvents([buyer, buyer, seller]);
    expect(rows).toEqual([
      expect.objectContaining({
        trades: 1,
        whaleSides: 2,
        uniqueWhales: 2,
        buyNotionalUsd: 200,
        sellNotionalUsd: 200,
        netNotionalUsd: 0,
        buySharePct: 0.5,
        positionAwareWhaleSides: 2,
        longEntryNotionalUsd: 200,
        shortEntryNotionalUsd: 200,
        entryNetNotionalUsd: 0,
        entryLongSharePct: 0.5,
      }),
    ]);
  });

  it('creates deterministic closed one-minute buckets', () => {
    const events = [
      normalizeHyperliquidUserFill({
        fill: {
          coin: 'BTC',
          px: 100,
          sz: 1,
          time: 60_001,
          tid: 1,
          side: 'B',
          startPosition: 0,
        },
        address: whaleA,
        trackedSymbols: new Set(['BTC']),
        identity,
      })!,
      normalizeHyperliquidUserFill({
        fill: {
          coin: 'BTC',
          px: 100,
          sz: 2,
          time: 119_999,
          tid: 2,
          side: 'A',
          startPosition: 0,
        },
        address: whaleB,
        trackedSymbols: new Set(['BTC']),
        identity,
      })!,
    ];
    expect(aggregateHyperliquidWhaleEvents(events)[0]).toMatchObject({
      ts: new Date(60_000),
      trades: 2,
      buyNotionalUsd: 100,
      sellNotionalUsd: 200,
      netNotionalUsd: -100,
      buySharePct: 1 / 3,
      longEntryNotionalUsd: 100,
      shortEntryNotionalUsd: 200,
      entryNetNotionalUsd: -100,
      entryLongSharePct: 1 / 3,
    });
  });
});
