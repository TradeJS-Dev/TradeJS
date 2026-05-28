const sharedStrategyReplayStates = new Map<string, unknown>();
const processLike = (
  globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
      once?: (event: string, listener: () => void) => void;
    };
  }
).process;
const SHARED_REPLAY_PROFILE =
  processLike?.env?.TRADEJS_STRATEGY_REPLAY_PROFILE === '1';
const sharedReplayProfile = {
  requests: 0,
  hits: 0,
  creates: 0,
  uncached: 0,
  releases: 0,
  releasedEntries: 0,
};

if (SHARED_REPLAY_PROFILE) {
  processLike?.once?.('exit', () => {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          strategyReplayProfile: {
            ...sharedReplayProfile,
            retainedEntries: sharedStrategyReplayStates.size,
          },
        },
        null,
        2,
      ),
    );
  });
}

export const getSharedStrategyReplayState = <TState>(
  key: string | undefined,
  createState: () => TState,
): TState => {
  if (SHARED_REPLAY_PROFILE) {
    sharedReplayProfile.requests += 1;
  }
  if (!key) {
    if (SHARED_REPLAY_PROFILE) {
      sharedReplayProfile.uncached += 1;
    }
    return createState();
  }

  const existing = sharedStrategyReplayStates.get(key);
  if (existing) {
    if (SHARED_REPLAY_PROFILE) {
      sharedReplayProfile.hits += 1;
    }
    return existing as TState;
  }

  const state = createState();
  sharedStrategyReplayStates.set(key, state);
  if (SHARED_REPLAY_PROFILE) {
    sharedReplayProfile.creates += 1;
  }
  return state;
};

export const releaseStrategyReplayCache = (keyPrefix: string) => {
  if (SHARED_REPLAY_PROFILE) {
    sharedReplayProfile.releases += 1;
  }
  for (const key of sharedStrategyReplayStates.keys()) {
    if (key === keyPrefix || key.startsWith(`${keyPrefix}:`)) {
      sharedStrategyReplayStates.delete(key);
      if (SHARED_REPLAY_PROFILE) {
        sharedReplayProfile.releasedEntries += 1;
      }
    }
  }
};
