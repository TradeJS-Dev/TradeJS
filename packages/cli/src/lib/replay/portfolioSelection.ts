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
