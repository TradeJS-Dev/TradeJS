import { runPortfolioShadowCycle } from '../lib/signals/portfolioShadowCycle';
import type {
  PortfolioEntryCandidate,
  PortfolioStrategyEntry,
} from '@tradejs/types';

const step = 900_000;
const symbol = 'SOLUSDT';
const candidate: PortfolioEntryCandidate = {
  id: 'delayed',
  strategy: 'TestChild',
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

it('commits only one concurrent evaluation of a boundary', async () => {
  let value: string | null = null;
  const store = {
    read: async () => value,
    compare: async (previous: string | null, next: string) => {
      if (previous !== value) return false;
      value = next;
      return true;
    },
  };
  const run = () =>
    runPortfolioShadowCycle({
      closedAt: step,
      entry,
      store,
      load: async () => ({
        candidates: [{ candidate, minNetRewardToRisk: 1 }],
        market: { candle: () => undefined },
        openingPrice: () => undefined,
      }),
    });
  const [winner, duplicate] = await Promise.all([run(), run()]);
  expect(winner).toMatchObject({ queued: [candidate.id] });
  expect(duplicate).toBeNull();
});

it.each([
  { direction: 'LONG', stop: 90, target: 120, exit: { low: 89, high: 106 } },
  { direction: 'SHORT', stop: 120, target: 90, exit: { low: 89, high: 106 } },
] as const)(
  'releases a $direction slot after a closed candle touches its protection',
  async ({ direction, stop, target, exit }) => {
    const regular = {
      ...candidate,
      id: 'regular',
      direction,
      stop,
      targets: [target],
      gate: { ...candidate.gate, approved: true, reason: null },
    };
    const other = { ...regular, id: 'other', symbol: 'ETHUSDT' };
    const sameSymbol = { ...regular, id: 'same-symbol' };
    let value: string | null = null;
    const store = {
      read: async () => value,
      compare: async (_: string | null, next: string) => {
        value = next;
        return true;
      },
    };
    const run = (
      closedAt: number,
      proposals: readonly PortfolioEntryCandidate[],
    ) =>
      runPortfolioShadowCycle({
        closedAt,
        store,
        entry: {
          ...entry,
          execution: { maxPositions: 2 },
          selectEntries: ({ candidates }) => ({
            ranked: candidates.map(({ id }) => id),
            pending: [],
          }),
        },
        load: async () => ({
          candidates: proposals.map((candidate) => ({
            candidate,
            minNetRewardToRisk: 1,
          })),
          market: {
            candle: (ticker, ago) => ({
              ...bar(closedAt - (ago + 1) * step),
              ...(closedAt === 3 * step && ticker === symbol ? exit : {}),
            }),
          },
          openingPrice: () => undefined,
        }),
      });

    await expect(run(step, [regular])).resolves.toMatchObject({
      selected: ['regular'],
    });
    await expect(run(2 * step, [sameSymbol, other])).resolves.toMatchObject({
      selected: ['other'],
      rejected: ['same-symbol'],
    });
    await expect(run(3 * step, [other, sameSymbol])).resolves.toMatchObject({
      selected: ['same-symbol'],
      rejected: ['other'],
      open: ['ETHUSDT', 'SOLUSDT'],
    });
  },
);
