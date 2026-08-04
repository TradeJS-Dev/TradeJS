import { buildHyperliquidConsensusFigures } from '../figures';

describe('buildHyperliquidConsensusFigures', () => {
  it('renders entry, stop, target, and consensus evidence', () => {
    const figures = buildHyperliquidConsensusFigures({
      direction: 'LONG',
      entryTimestamp: 1_700_000_000_000,
      entryPrice: 100,
      stopLossPrice: 98,
      takeProfitPrice: 104,
      context: {
        signalDirection: 'LONG',
        symbol: 'BTC',
        interval: '5m',
        asOfTs: 1_700_000_240_000,
        windowEndTs: 1_700_000_300_000,
        ageMs: 0,
        uniqueWhales: 4,
        coveredWhales: 90,
        expectedWhales: 100,
        coveragePct: 0.9,
        positionAwarePct: 1,
        entryWhales: 4,
        longEntryWhales: 4,
        shortEntryWhales: 1,
        longExitWhales: 1,
        shortExitWhales: 0,
        totalEntryNotionalUsd: 240_000,
        longEntryNotionalUsd: 180_000,
        shortEntryNotionalUsd: 60_000,
        longExitNotionalUsd: 20_000,
        shortExitNotionalUsd: 0,
        entryNetNotionalUsd: 120_000,
        entryLongSharePct: 0.75,
        consensusScore: 0.5,
        absoluteConsensusScore: 0.5,
      },
    });

    expect(figures.lines).toHaveLength(2);
    expect(figures.points).toHaveLength(1);
    expect(figures.annotations).toHaveLength(1);
    expect(figures.annotations?.[0]).toMatchObject({
      kind: 'hyperliquid_consensus_entry_evidence',
      title: 'Hyperliquid consensus LONG',
    });
    expect(figures.annotations?.[0].items).toContain('Consensus: 50.0%');
  });
});
