import type {
  Candle,
  PortfolioEntryBatch,
  PortfolioEntryCandidate,
  PortfolioStrategyEntry,
} from '@tradejs/types';
import { validatePortfolioSelection } from '../portfolio/selection';

export const portfolioShadowStep = 900_000;

interface Proposal {
  candidate: PortfolioEntryCandidate;
  minNetRewardToRisk: number;
}

export interface PortfolioShadowMarket {
  candidates: readonly Proposal[];
  market: PortfolioEntryBatch['market'];
  openingPrice(symbol: string): number | undefined;
}

interface ShadowState {
  version: 1;
  closedAt: number;
  pending: Array<Proposal & { confirmAt: number }>;
  positions: PortfolioEntryCandidate[];
  outcome: PortfolioShadowOutcome;
}

export interface PortfolioShadowOutcome {
  closedAt: number;
  candidates: number;
  queued: string[];
  confirmed: string[];
  selected: string[];
  rejected: string[];
  expired: string[];
  open: string[];
}

function reachedTerminalExit(
  position: PortfolioEntryCandidate,
  candle: Candle,
) {
  const { direction, stop, targets } = position;
  return direction === 'LONG'
    ? candle.low <= stop ||
        (targets.length > 0 && targets.every((price) => candle.high >= price))
    : candle.high >= stop ||
        (targets.length > 0 && targets.every((price) => candle.low <= price));
}

export async function runPortfolioShadowCycle({
  closedAt,
  entry,
  store,
  load,
}: {
  closedAt: number;
  entry: Pick<PortfolioStrategyEntry, 'selectEntries' | 'confirmEntry'> & {
    execution: { maxPositions: number };
  };
  store: {
    read(): Promise<string | null>;
    compare(previous: string | null, next: string): Promise<boolean>;
  };
  load(): Promise<PortfolioShadowMarket>;
}): Promise<PortfolioShadowOutcome | null> {
  if (
    !Number.isSafeInteger(closedAt) ||
    closedAt <= 0 ||
    closedAt % portfolioShadowStep
  ) {
    throw new Error('Expected a closed M15 portfolio boundary');
  }
  const raw = await store.read();
  const previous = raw === null ? null : (JSON.parse(raw) as ShadowState);
  if (
    previous &&
    (previous.version !== 1 ||
      !Number.isSafeInteger(previous.closedAt) ||
      !Array.isArray(previous.pending) ||
      !Array.isArray(previous.positions))
  ) {
    throw new Error('Invalid portfolio shadow checkpoint');
  }
  if (previous && previous.closedAt >= closedAt) return null;

  const snapshot = await load();
  const candleAt = (symbol: string, ago: number) => {
    const value = snapshot.market.candle(symbol, ago);
    return value?.timestamp === closedAt - (ago + 1) * portfolioShadowStep
      ? value
      : undefined;
  };
  const { maxPositions } = entry.execution;
  const positions = new Map<string, PortfolioEntryCandidate>();
  for (const position of previous?.positions ?? []) {
    const bars = (closedAt - previous!.closedAt) / portfolioShadowStep;
    let closed = false;
    for (let ago = Math.min(bars, 2880) - 1; ago >= 0; ago--) {
      const candle = candleAt(position.symbol, ago);
      if (candle && reachedTerminalExit(position, candle)) {
        closed = true;
        break;
      }
    }
    if (!closed) positions.set(position.symbol, position);
  }
  const outcome: PortfolioShadowOutcome = {
    closedAt,
    candidates: snapshot.candidates.length,
    queued: [],
    confirmed: [],
    selected: [],
    rejected: [],
    expired: [],
    open: [],
  };
  const hasCapacity = (symbol: string) =>
    positions.size < maxPositions && !positions.has(symbol);
  for (const {
    candidate,
    confirmAt,
    minNetRewardToRisk,
  } of previous?.pending ?? []) {
    if (confirmAt !== closedAt) {
      outcome.expired.push(candidate.id);
      continue;
    }
    const candle = candleAt(candidate.symbol, 0);
    const openingPrice = snapshot.openingPrice(candidate.symbol);
    if (
      !candle ||
      openingPrice === undefined ||
      !Number.isFinite(openingPrice) ||
      openingPrice <= 0
    ) {
      throw new Error(
        `Incomplete portfolio confirmation market data for ${candidate.symbol}`,
      );
    }
    const fill = entry.confirmEntry({
      candidate,
      candle,
      openingPrice,
      minNetRewardToRisk,
    });
    if (
      !fill ||
      !Number.isFinite(fill.qty) ||
      fill.qty <= 0 ||
      !hasCapacity(candidate.symbol)
    ) {
      outcome.rejected.push(candidate.id);
      continue;
    }
    positions.set(candidate.symbol, candidate);
    outcome.confirmed.push(candidate.id);
  }

  const proposals = new Map(
    snapshot.candidates.map((value) => [value.candidate.id, value]),
  );
  if (proposals.size !== snapshot.candidates.length)
    throw new Error('Duplicate portfolio proposal');
  const batch = {
    closedAt,
    candidates: snapshot.candidates.map(({ candidate }) => candidate),
    market: {
      candle: (symbol: string, ago: number) =>
        Number.isSafeInteger(ago) && ago >= 0
          ? candleAt(symbol, ago)
          : undefined,
    },
  };
  const selection = entry.selectEntries(batch);
  validatePortfolioSelection(batch, selection, portfolioShadowStep);
  for (const id of selection.ranked) {
    const { candidate } = proposals.get(id)!;
    if (hasCapacity(candidate.symbol)) {
      positions.set(candidate.symbol, candidate);
      outcome.selected.push(id);
    } else outcome.rejected.push(id);
  }
  const pending = selection.pending.map(({ candidateId, confirmAt }) => ({
    ...proposals.get(candidateId)!,
    confirmAt,
  }));
  outcome.queued = pending.map(({ candidate }) => candidate.id);
  outcome.open = [...positions.keys()];
  const state: ShadowState = {
    version: 1,
    closedAt,
    pending,
    positions: [...positions.values()],
    outcome,
  };
  return (await store.compare(raw, JSON.stringify(state))) ? outcome : null;
}
