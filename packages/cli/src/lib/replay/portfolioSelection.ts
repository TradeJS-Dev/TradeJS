import type {
  PortfolioEntryBatch,
  PortfolioEntryCandidate,
  PortfolioEntrySelection,
} from '@tradejs/types';

export function validatePortfolioSelection(
  batch: PortfolioEntryBatch,
  selection: PortfolioEntrySelection,
  step: number,
): void {
  const seen = new Set<string>();
  const available = new Map(batch.candidates.map((item) => [item.id, item]));
  const take = (id: string): PortfolioEntryCandidate => {
    const candidate = available.get(id);
    if (!candidate || seen.has(id)) {
      throw new Error(`Unknown or repeated portfolio candidate: ${id}`);
    }
    seen.add(id);
    return candidate;
  };
  for (const id of selection.ranked) {
    if (!take(id).gate.approved)
      throw new Error(`Rejected immediate entry: ${id}`);
  }
  for (const { candidateId, confirmAt } of selection.pending) {
    const { gate } = take(candidateId);
    if (
      gate.approved ||
      gate.explicitHardBlock ||
      !gate.reason?.startsWith('AI_QUALITY_BELOW_MIN (') ||
      confirmAt !== batch.closedAt + step
    ) {
      throw new Error(`Invalid delayed portfolio entry: ${candidateId}`);
    }
  }
}

/** Every child reaches the entry boundary or finishes before selection starts. */
export async function choosePortfolioEntries<T, E>(
  evaluate: readonly ((offer: (entry: E) => Promise<boolean>) => Promise<T>)[],
  choose: (
    offers: readonly { entry: E; submit(): Promise<T> }[],
  ) => Promise<void>,
): Promise<void> {
  let remaining = evaluate.length;
  if (!remaining) return;
  const ready = Promise.withResolvers<void>();
  const offers: { entry: E; submit(): Promise<T>; refuse(): void }[] = [];
  const markReady = () => {
    if (--remaining === 0) ready.resolve();
  };
  const tasks = evaluate.map((run) => {
    let offered = false;
    const task = Promise.resolve()
      .then(() =>
        run((entry) => {
          if (offered)
            throw new Error('Repeated entry from one child per candle');
          offered = true;
          const decision = Promise.withResolvers<boolean>();
          offers.push({
            entry,
            submit: () => {
              decision.resolve(true);
              return task;
            },
            refuse: () => decision.resolve(false),
          });
          markReady();
          return decision.promise;
        }),
      )
      .finally(() => {
        if (!offered) markReady();
      });
    return task;
  });
  const completed = Promise.allSettled(tasks);
  await ready.promise;
  try {
    await choose(offers);
  } finally {
    for (const offer of offers) offer.refuse();
    const failed = (await completed).find(
      (result) => result.status === 'rejected',
    );
    if (failed) throw failed.reason;
  }
}
