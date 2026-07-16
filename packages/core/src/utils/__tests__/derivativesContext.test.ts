import { buildDerivativesContext } from '../derivativesContext';
import type { DerivativesRow } from '@tradejs/types';

const ts = Date.UTC(2026, 0, 1, 12, 0, 0);

const row = (params: {
  offsetHours: number;
  interval?: DerivativesRow['interval'];
  openInterest?: number | null;
  fundingRate?: number | null;
  liqLong?: number | null;
  liqShort?: number | null;
  liqTotal?: number | null;
}): DerivativesRow => {
  const interval = params.interval ?? '15m';
  const intervalMs = interval === '1h' ? 60 * 60 * 1000 : 15 * 60 * 1000;

  return {
    symbol: 'ETHUSDT',
    interval,
    ts: new Date(ts - params.offsetHours * 60 * 60 * 1000 - intervalMs),
    openInterest: params.openInterest ?? null,
    fundingRate: params.fundingRate ?? null,
    liqLong: params.liqLong ?? null,
    liqShort: params.liqShort ?? null,
    liqTotal: params.liqTotal ?? null,
    source: 'coinalyze',
  };
};

describe('buildDerivativesContext', () => {
  it('returns missing context without rows', () => {
    const context = buildDerivativesContext({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      timestamp: ts,
      rowsByInterval: {},
    });

    expect(context.summary).toEqual({
      pressure: 'neutral',
      directionAligned: null,
      riskFlags: ['missing_derivatives'],
      fundingChange1h: null,
      oiAcceleration: null,
      priceOiDivergenceType: 'unknown',
      crowdingPersistenceBars: null,
    });
    expect(context.intervals).toEqual({});
  });

  it('ignores unavailable rows and computes OI changes from closed intervals only', () => {
    const context = buildDerivativesContext({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      timestamp: ts,
      rowsByInterval: {
        '15m': [
          row({ offsetHours: 4, openInterest: 100, fundingRate: 0.0001 }),
          row({ offsetHours: 1, openInterest: 110, fundingRate: 0.0001 }),
          row({ offsetHours: 0, openInterest: 121, fundingRate: 0.0001 }),
          {
            ...row({
              offsetHours: -1,
              openInterest: 999,
              fundingRate: 0.0001,
            }),
            ts: new Date(ts + 60 * 60 * 1000),
          },
        ],
      },
    });

    expect(context.intervals['15m']?.openInterest).toBe(121);
    expect(context.intervals['15m']?.oiChangePct1h).toBe(10);
    expect(context.intervals['15m']?.oiChangePct4h).toBe(21);
    expect(context.summary.directionAligned).toBe(true);
  });

  it('does not expose a derivatives interval before that interval closes', () => {
    const signalTimestamp = Date.UTC(2026, 0, 1, 12, 45, 0);
    const oneHourRows: DerivativesRow[] = [
      {
        ...row({ offsetHours: 0, interval: '1h', openInterest: 100 }),
        ts: new Date(Date.UTC(2026, 0, 1, 11, 0, 0)),
      },
      {
        ...row({ offsetHours: 0, interval: '1h', openInterest: 110 }),
        ts: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
      },
    ];

    const beforeClose = buildDerivativesContext({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      timestamp: signalTimestamp,
      rowsByInterval: { '1h': oneHourRows },
    });
    const afterClose = buildDerivativesContext({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      timestamp: Date.UTC(2026, 0, 1, 13, 0, 0),
      rowsByInterval: { '1h': oneHourRows },
    });

    expect(beforeClose.intervals['1h']?.asOfTs).toBe(
      Date.UTC(2026, 0, 1, 11, 0, 0),
    );
    expect(beforeClose.intervals['1h']?.openInterest).toBe(100);
    expect(afterClose.intervals['1h']?.asOfTs).toBe(
      Date.UTC(2026, 0, 1, 12, 0, 0),
    );
    expect(afterClose.intervals['1h']?.openInterest).toBe(110);
  });

  it('detects crowded long funding as a LONG risk', () => {
    const context = buildDerivativesContext({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      timestamp: ts,
      rowsByInterval: {
        '15m': [
          row({ offsetHours: 2, openInterest: 100, fundingRate: 0.0001 }),
          row({ offsetHours: 1, openInterest: 101, fundingRate: 0.0001 }),
          row({ offsetHours: 0, openInterest: 102, fundingRate: 0.0008 }),
        ],
      },
    });

    expect(context.summary.pressure).toBe('crowded_long');
    expect(context.summary.riskFlags).toContain('crowded_long');
    expect(context.summary.directionAligned).toBe(false);
  });

  it('detects liquidation spikes and imbalance', () => {
    const context = buildDerivativesContext({
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      timestamp: ts,
      rowsByInterval: {
        '15m': [
          row({
            offsetHours: 2,
            openInterest: 100,
            fundingRate: 0,
            liqLong: 10,
            liqShort: 10,
            liqTotal: 20,
          }),
          row({
            offsetHours: 1,
            openInterest: 105,
            fundingRate: 0,
            liqLong: 10,
            liqShort: 10,
            liqTotal: 20,
          }),
          row({
            offsetHours: 0,
            openInterest: 110,
            fundingRate: 0,
            liqLong: 120,
            liqShort: 10,
            liqTotal: 130,
          }),
        ],
      },
    });

    expect(context.summary.pressure).toBe('long_flush');
    expect(context.summary.riskFlags).toContain('long_liquidation_spike');
    expect(context.intervals['15m']?.liqSpikeRatio).toBe(6.5);
    expect(context.summary.directionAligned).toBe(true);
  });
});
