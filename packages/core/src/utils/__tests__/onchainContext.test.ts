import {
  buildOnchainContext,
  normalizeOnchainIntervals,
} from '../onchainContext';
import type { OnchainFlowRow } from '@tradejs/types';

const ts = Date.UTC(2026, 0, 1, 12, 0, 0);

const row = (params: {
  offsetHours: number;
  whaleNetFlowUsd?: number | null;
  smartTraderNetFlowUsd?: number | null;
  cexDepositUsd?: number | null;
  cexWithdrawUsd?: number | null;
  dexBuyUsd?: number | null;
  dexSellUsd?: number | null;
  confidenceWeightedBias?: number | null;
}): OnchainFlowRow => ({
  symbol: 'ETHUSDT',
  interval: '15m',
  ts: new Date(ts - params.offsetHours * 60 * 60 * 1000),
  whaleNetFlowUsd: params.whaleNetFlowUsd ?? null,
  smartTraderNetFlowUsd: params.smartTraderNetFlowUsd ?? null,
  cexDepositUsd: params.cexDepositUsd ?? null,
  cexWithdrawUsd: params.cexWithdrawUsd ?? null,
  dexBuyUsd: params.dexBuyUsd ?? null,
  dexSellUsd: params.dexSellUsd ?? null,
  confidenceWeightedBias: params.confidenceWeightedBias ?? null,
  source: 'arkham',
});

describe('buildOnchainContext', () => {
  it('normalizes supported onchain intervals and drops duplicates', () => {
    expect(normalizeOnchainIntervals('1m, 5m, 15m, 1h, 1d, 15m')).toEqual([
      '1m',
      '5m',
      '15m',
      '1h',
    ]);
  });

  it('returns missing context without rows', () => {
    const context = buildOnchainContext({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      timestamp: ts,
      rowsByInterval: {},
    });

    expect(context.summary).toEqual({
      pressure: 'unknown',
      directionAligned: null,
      riskFlags: ['missing_onchain'],
      confidenceWeightedBias: null,
      netFlowUsd: null,
    });
    expect(context.intervals).toEqual({});
  });

  it('ignores future rows and detects accumulation aligned with LONG', () => {
    const context = buildOnchainContext({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      timestamp: ts,
      rowsByInterval: {
        '15m': [
          row({ offsetHours: 2, cexDepositUsd: 100, cexWithdrawUsd: 120 }),
          row({ offsetHours: 1, cexDepositUsd: 100, cexWithdrawUsd: 140 }),
          row({
            offsetHours: 0,
            whaleNetFlowUsd: 10_000,
            smartTraderNetFlowUsd: 5_000,
            cexDepositUsd: 100,
            cexWithdrawUsd: 1_000,
            dexBuyUsd: 2_000,
            dexSellUsd: 250,
            confidenceWeightedBias: 0.6,
          }),
          {
            ...row({
              offsetHours: -1,
              whaleNetFlowUsd: -999_000,
              confidenceWeightedBias: -1,
            }),
            ts: new Date(ts + 60 * 60 * 1000),
          },
        ],
      },
    });

    expect(context.intervals['15m']?.whaleNetFlowUsd).toBe(10000);
    expect(context.summary.pressure).toBe('accumulation');
    expect(context.summary.directionAligned).toBe(true);
    expect(context.summary.riskFlags).toContain('whale_accumulation');
    expect(context.summary.riskFlags).toContain('cex_withdrawal_spike');
  });

  it('detects CEX deposit pressure as distribution against LONG', () => {
    const context = buildOnchainContext({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      timestamp: ts,
      rowsByInterval: {
        '15m': [
          row({ offsetHours: 2, cexDepositUsd: 100, cexWithdrawUsd: 90 }),
          row({ offsetHours: 1, cexDepositUsd: 100, cexWithdrawUsd: 90 }),
          row({
            offsetHours: 0,
            whaleNetFlowUsd: -5_000,
            smartTraderNetFlowUsd: -2_000,
            cexDepositUsd: 1_000,
            cexWithdrawUsd: 50,
            confidenceWeightedBias: -0.5,
          }),
        ],
      },
    });

    expect(context.summary.pressure).toBe('distribution');
    expect(context.summary.directionAligned).toBe(false);
    expect(context.summary.riskFlags).toContain('cex_deposit_spike');
    expect(context.summary.riskFlags).toContain('smart_money_distribution');
  });
});
