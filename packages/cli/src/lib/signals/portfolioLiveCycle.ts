import type {
  PortfolioChildRuntime,
  PortfolioEntryBatch,
  PortfolioEntryCandidate,
  PortfolioStrategyEntry,
  PreparedPortfolioEntry,
  Signal,
  StrategyConfig,
} from '@tradejs/types';
import { validatePortfolioSelection } from '../portfolio/selection';
import { portfolioShadowStep as step } from './portfolioShadowCycle';

export interface LivePortfolioOffer {
  candidate: PortfolioEntryCandidate;
  prepared: PreparedPortfolioEntry;
  minNetRewardToRisk: number;
}

type Confirmation = Parameters<
  PortfolioChildRuntime['submitPortfolioEntry']
>[0]['confirmation'];
export interface LivePortfolioMarket {
  offers: readonly LivePortfolioOffer[];
  market: PortfolioEntryBatch['market'];
  openingPrice(candidate: PortfolioEntryCandidate): Promise<number | undefined>;
  submit(
    offer: LivePortfolioOffer,
    confirmation?: Confirmation,
  ): Promise<string | Signal>;
}

interface LiveCheckpoint {
  version: 1;
  closedAt: number;
  revision?: string;
  pending: Array<LivePortfolioOffer & { confirmAt: number }>;
}

export async function runPortfolioLiveCycle({
  closedAt,
  entry,
  config,
  revision,
  store,
  load,
  onExecutedSignal,
}: {
  closedAt: number;
  config: StrategyConfig;
  revision?: string;
  entry: Pick<PortfolioStrategyEntry, 'selectEntries' | 'confirmEntry'>;
  store: {
    read(): Promise<string | null>;
    compare(previous: string | null, next: string): Promise<boolean>;
  };
  load(pending: readonly LivePortfolioOffer[]): Promise<LivePortfolioMarket>;
  onExecutedSignal?: (signal: Signal) => void;
}) {
  if (!Number.isSafeInteger(closedAt) || closedAt <= 0 || closedAt % step) {
    throw new Error('Expected a closed M15 portfolio boundary');
  }
  const raw = await store.read();
  const previous = raw === null ? null : (JSON.parse(raw) as LiveCheckpoint);
  if (
    previous &&
    (previous.version !== 1 ||
      !Number.isSafeInteger(previous.closedAt) ||
      !Array.isArray(previous.pending))
  ) {
    throw new Error('Invalid live portfolio checkpoint');
  }
  if (previous && previous.closedAt >= closedAt) return null;

  const due = (
    previous?.revision === revision ? previous?.pending ?? [] : []
  ).filter(({ confirmAt }) => confirmAt === closedAt);
  const claimed = JSON.stringify({
    version: 1,
    closedAt,
    revision,
    pending: due,
  });
  if (!(await store.compare(raw, claimed))) return null;

  const snapshot = await load(due);
  const submit = async (
    offer: LivePortfolioOffer,
    confirmation?: Confirmation,
  ) => {
    const result = await snapshot.submit(offer, confirmation);
    if (typeof result !== 'string' && result.orderStatus === 'completed') {
      onExecutedSignal?.(result);
    }
  };
  const batch: PortfolioEntryBatch = {
    closedAt,
    candidates: snapshot.offers.map(({ candidate }) => candidate),
    market: {
      candle: (symbol, ago) => {
        if (!Number.isSafeInteger(ago) || ago < 0) return undefined;
        const candle = snapshot.market.candle(symbol, ago);
        return candle?.timestamp === closedAt - (ago + 1) * step
          ? candle
          : undefined;
      },
    },
  };
  const offers = new Map(
    snapshot.offers.map((offer) => [offer.candidate.id, offer]),
  );
  if (offers.size !== snapshot.offers.length)
    throw new Error('Duplicate live portfolio proposal');
  const selection = entry.selectEntries(batch);
  validatePortfolioSelection(batch, selection, step);
  const pending = selection.pending.map(({ candidateId, confirmAt }) => ({
    ...offers.get(candidateId)!,
    confirmAt,
  }));
  if (
    !(await store.compare(
      claimed,
      JSON.stringify({ version: 1, closedAt, revision, pending }),
    ))
  )
    return null;

  for (const offer of due) {
    const { candidate, minNetRewardToRisk } = offer;
    const candle = batch.market.candle(candidate.symbol, 0);
    if (!candle) continue;
    const openingPrice = await snapshot.openingPrice(candidate);
    if (!openingPrice || !Number.isFinite(openingPrice) || openingPrice < 0)
      continue;
    const fill = entry.confirmEntry({
      candidate,
      candle,
      openingPrice,
      minNetRewardToRisk,
      config,
    });
    if (
      !fill ||
      !Number.isFinite(fill.qty) ||
      fill.qty <= 0 ||
      !Number.isFinite(fill.risk) ||
      fill.risk <= 0
    )
      continue;
    await submit(offer, {
      ...fill,
      price: openingPrice,
      timestamp: closedAt,
    });
  }
  for (const id of selection.ranked) await submit(offers.get(id)!);
  return { closedAt, candidates: offers.size, pending: pending.length };
}
