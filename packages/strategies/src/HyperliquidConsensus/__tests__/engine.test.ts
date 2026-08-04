import type { BaseHyperliquidWhaleFlowContext } from '@tradejs/types';
import { config } from '../config';
import { evaluateHyperliquidConsensus } from '../engine';

const makeFlow = (
  overrides: Partial<BaseHyperliquidWhaleFlowContext> = {},
): BaseHyperliquidWhaleFlowContext => ({
  source: 'hyperliquid_trades',
  interval: '5m',
  asOfTs: 1_700_000_240_000,
  windowEndTs: 1_700_000_300_000,
  ageMs: 0,
  stale: false,
  symbol: 'BTC',
  trades: 8,
  whaleSides: 8,
  uniqueWhales: 4,
  coveredWhales: 90,
  expectedWhales: 100,
  coveragePct: 0.9,
  coverageSufficient: true,
  buyNotionalUsd: 180_000,
  sellNotionalUsd: 60_000,
  netNotionalUsd: 120_000,
  buySharePct: 0.75,
  positionAwareWhaleSides: 8,
  positionAwarePct: 1,
  longEntryWhales: 4,
  shortEntryWhales: 1,
  longExitWhales: 1,
  shortExitWhales: 0,
  longEntryNotionalUsd: 180_000,
  shortEntryNotionalUsd: 60_000,
  longExitNotionalUsd: 20_000,
  shortExitNotionalUsd: 0,
  entryNetNotionalUsd: 120_000,
  entryLongSharePct: 0.75,
  universeFingerprint: 'universe',
  whaleRegistryFingerprint: 'wallets',
  ...overrides,
});

describe('evaluateHyperliquidConsensus', () => {
  it('emits LONG for fresh multi-wallet net buying', () => {
    expect(
      evaluateHyperliquidConsensus({ flow: makeFlow(), config: config as any }),
    ).toMatchObject({
      kind: 'signal',
      context: {
        signalDirection: 'LONG',
        uniqueWhales: 4,
        totalEntryNotionalUsd: 240_000,
        entryWhales: 4,
        consensusScore: 0.5,
      },
    });
  });

  it('emits SHORT for fresh multi-wallet net selling', () => {
    expect(
      evaluateHyperliquidConsensus({
        flow: makeFlow({
          longEntryNotionalUsd: 50_000,
          shortEntryNotionalUsd: 200_000,
          entryNetNotionalUsd: -150_000,
          entryLongSharePct: 0.2,
          shortEntryWhales: 4,
        }),
        config: config as any,
      }),
    ).toMatchObject({
      kind: 'signal',
      context: {
        signalDirection: 'SHORT',
        consensusScore: -0.6,
      },
    });
  });

  it.each([
    ['HLC_NO_CONTEXT', null],
    ['HLC_CONTEXT_STALE', makeFlow({ stale: true })],
    [
      'HLC_INSUFFICIENT_COVERAGE',
      makeFlow({ coveragePct: 0.79, coverageSufficient: false }),
    ],
    ['HLC_CONTEXT_TOO_OLD', makeFlow({ ageMs: 60_001 })],
    ['HLC_INSUFFICIENT_WALLETS', makeFlow({ uniqueWhales: 2 })],
    ['HLC_INSUFFICIENT_POSITION_DATA', makeFlow({ positionAwarePct: 0.79 })],
    [
      'HLC_INSUFFICIENT_ENTRY_NOTIONAL',
      makeFlow({
        longEntryNotionalUsd: 50_000,
        shortEntryNotionalUsd: 30_000,
        entryNetNotionalUsd: 20_000,
        entryLongSharePct: 0.625,
      }),
    ],
    [
      'HLC_INSUFFICIENT_ENTRY_IMBALANCE',
      makeFlow({
        longEntryNotionalUsd: 90_000,
        shortEntryNotionalUsd: 60_000,
        entryNetNotionalUsd: 30_000,
        entryLongSharePct: 0.6,
      }),
    ],
    [
      'HLC_NEUTRAL_CONSENSUS',
      makeFlow({
        longEntryNotionalUsd: 300_000,
        shortEntryNotionalUsd: 200_000,
        entryNetNotionalUsd: 100_000,
        entryLongSharePct: 0.6,
      }),
    ],
  ] as const)('returns %s when evidence is invalid', (code, flow) => {
    expect(
      evaluateHyperliquidConsensus({ flow, config: config as any }),
    ).toEqual({ kind: 'skip', code });
  });
});
