import { runPortfolioShadowCycle } from '../lib/signals/portfolioShadowCycle';
import type {
  PortfolioEntryCandidate,
  PortfolioStrategyEntry,
} from '@tradejs/types';

const step = 900_000;
const symbol = 'SOLUSDT';
const candidate: PortfolioEntryCandidate = {
  id: 'delayed',
  strategy: 'TradingPatterns',
  symbol,
  direction: 'LONG',
  stop: 90,
  targets: [120],
  gate: {
    approved: false,
    rawQuality: 3,
    reason: 'AI_QUALITY_BELOW_MIN (3 < 4)',
    explicitHardBlock: false,
  },
};
const entry = {
  selectEntries: ({ candidates }) => ({
    ranked: [],
    pending: candidates.map(({ id }) => ({
      candidateId: id,
      confirmAt: 2 * step,
    })),
  }),
  confirmEntry: ({ candle }) =>
    candle.close > candle.open ? { qty: 0.5, risk: 5 } : null,
  execution: { maxPositions: 3 },
} satisfies Pick<PortfolioStrategyEntry, 'selectEntries' | 'confirmEntry'> & {
  execution: { maxPositions: number };
};
const bar = (timestamp: number) => ({
  timestamp,
  open: 100,
  high: 106,
  low: 94,
  close: 105,
  turnover: 1,
  volume: 1,
});

it('restores a queued signal with a fresh worker and commits its confirmation once', async () => {
  let value: string | null = null;
  function startWorker() {
    return {
      read: async () => value,
      compare: async (previous: string | null, next: string) => {
        if (previous !== value) return false;
        value = next;
        return true;
      },
    };
  }
  const run = (closedAt: number, store = startWorker()) =>
    runPortfolioShadowCycle({
      closedAt,
      entry,
      store,
      load: async () => ({
        candidates:
          closedAt === step ? [{ candidate, minNetRewardToRisk: 1 }] : [],
        market: {
          candle: (_: string, ago: number) => bar(closedAt - (ago + 1) * step),
        },
        openingPrice: () => 105,
      }),
    });
  expect(await run(step)).toMatchObject({
    queued: [candidate.id],
    confirmed: [],
  });
  const outcome = await run(2 * step, startWorker());
  expect(outcome).toMatchObject({ queued: [], confirmed: [candidate.id] });
  expect(await run(2 * step, startWorker())).toBeNull();
});

it('leaves the checkpoint intact while the confirmation price is missing, and expires a missed boundary', async () => {
  let value: string | null = null;
  const store = {
    read: async () => value,
    compare: async (_: string | null, next: string) => {
      value = next;
      return true;
    },
  };
  const run = (closedAt: number) =>
    runPortfolioShadowCycle({
      closedAt,
      entry,
      store,
      load: async () => ({
        candidates:
          closedAt === step ? [{ candidate, minNetRewardToRisk: 1 }] : [],
        market: { candle: (_, ago) => bar(closedAt - (ago + 1) * step) },
        openingPrice: () => undefined,
      }),
    });
  await run(step);
  const checkpoint = value;
  await expect(run(2 * step)).rejects.toThrow(
    'Incomplete portfolio confirmation',
  );
  expect(value).toEqual(checkpoint);
  await expect(run(3 * step)).resolves.toMatchObject({
    expired: [candidate.id],
    confirmed: [],
  });
});
