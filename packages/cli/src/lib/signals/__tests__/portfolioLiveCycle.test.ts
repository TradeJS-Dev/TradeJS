import type { PortfolioEntryCandidate } from '@tradejs/types';
import {
  runPortfolioLiveCycle,
  type LivePortfolioMarket,
} from '../portfolioLiveCycle';

const step = 900_000;

function fixture() {
  let checkpoint: string | null = null;
  const store = {
    read: async () => checkpoint,
    compare: async (previous: string | null, next: string) => {
      if (checkpoint !== previous) return false;
      checkpoint = next;
      return true;
    },
  };
  const candidate: PortfolioEntryCandidate = {
    id: 'signal',
    strategy: 'Probe',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    stop: 90,
    targets: [120],
    gate: {
      approved: true,
      reason: null,
      rawQuality: 5,
      explicitHardBlock: false,
    },
  };
  const submit = jest.fn(async () => 'OK');
  const offer = { candidate, prepared: {} as never, minNetRewardToRisk: 1 };
  const load = jest.fn(async () => ({
    offers: [offer],
    market: { candle: () => undefined },
    openingPrice: async () => 100,
    submit,
  }));
  const options = {
    closedAt: step,
    config: { MAX_LOSS_VALUE: 2 },
    store,
    load,
    entry: {
      selectEntries: () => ({ ranked: [candidate.id], pending: [] }),
      confirmEntry: () => null,
    },
  };
  return { options, offer, submit, load };
}

it('claims a boundary before a child can evaluate or submit', async () => {
  const { options, load, submit } = fixture();
  await Promise.all([
    runPortfolioLiveCycle(options),
    runPortfolioLiveCycle(options),
  ]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledTimes(1);
});

it('restores a deferred offer on the next closed candle and uses the current quote and configured risk', async () => {
  const { options, offer, submit } = fixture();
  offer.candidate.gate = {
    approved: false,
    reason: 'AI_QUALITY_BELOW_MIN (3 < 4)',
    rawQuality: 3,
    explicitHardBlock: false,
  };
  const confirmEntry = jest.fn(() => ({ risk: 1, qty: 0.1 }));
  const candle = {
    timestamp: step,
    open: 100,
    close: 102,
    low: 99,
    high: 103,
    volume: 1,
    turnover: 1,
  };
  const entry = {
    selectEntries: ({
      candidates,
    }: {
      candidates: readonly PortfolioEntryCandidate[];
    }) => ({
      ranked: [],
      pending: candidates.map(({ id }) => ({
        candidateId: id,
        confirmAt: 2 * step,
      })),
    }),
    confirmEntry,
  };
  await runPortfolioLiveCycle({ ...options, entry });
  expect(submit).not.toHaveBeenCalled();
  const load = jest.fn(
    async (): Promise<LivePortfolioMarket> => ({
      offers: [],
      market: { candle: () => candle },
      openingPrice: async () => 102.2,
      submit,
    }),
  );
  await runPortfolioLiveCycle({ ...options, closedAt: 2 * step, entry, load });
  expect(confirmEntry).toHaveBeenCalledWith(
    expect.objectContaining({
      candle,
      openingPrice: 102.2,
      config: { MAX_LOSS_VALUE: 2 },
    }),
  );
  expect(submit).toHaveBeenCalledWith(expect.objectContaining(offer), {
    risk: 1,
    qty: 0.1,
    price: 102.2,
    timestamp: 2 * step,
  });
  await runPortfolioLiveCycle({ ...options, closedAt: 2 * step, entry, load });
  expect(submit).toHaveBeenCalledTimes(1);
});
