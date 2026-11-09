import {
  buildPortfolioContext,
  createPortfolioState,
  portfolioFingerprint,
  reconcilePortfolio,
  reservePortfolioEntry,
  portfolioCloseCommands,
  validatePortfolioObservation,
} from '@tradejs/core/portfolio';
import type {
  PortfolioPolicyConfig,
  PortfolioStateStore,
  PortfolioState,
  PortfolioObservation,
  PortfolioReservation,
  PortfolioPosition,
  PortfolioCloseIntent,
} from '@tradejs/types';

export interface PortfolioExecutionAdapter {
  /** Idempotent bookkeeping, before removing a confirmed close intent from durable state. */
  confirmClosed?(intent: PortfolioCloseIntent, asOf: number): Promise<void>;
  observe(
    asOf: number,
    reservations: readonly PortfolioReservation[],
  ): Promise<PortfolioObservation>;
  close(
    position: PortfolioPosition,
    intent: PortfolioCloseIntent,
    asOf: number,
  ): Promise<void>;
}
/** Shared by runtime and replay. IO is behind observation, execution and CAS storage. */
export function createPortfolioCoordinator({
  policy,
  strategy,
  store,
  execution,
}: {
  policy: PortfolioPolicyConfig;
  strategy: string;
  store: PortfolioStateStore;
  execution: PortfolioExecutionAdapter;
}) {
  const fingerprint = portfolioFingerprint(policy, strategy);
  let cache:
    | { revision: number; bucket: number; observation: PortfolioObservation }
    | undefined;
  async function transact<T>(
    now: number,
    change: (
      s: PortfolioState,
      o: PortfolioObservation,
    ) => { state: PortfolioState; result: T },
    force = false,
  ) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const previous = await store.read();
      if (previous && previous.fingerprint !== fingerprint)
        throw new Error(
          'Portfolio policy changed under existing state; reconcile the persisted scope before changing configuration',
        );
      const base = previous ?? createPortfolioState(fingerprint);
      const bucket = Math.floor(now / policy.observationIntervalMs);
      const observation =
        !force && cache?.revision === base.revision && cache.bucket === bucket
          ? cache.observation
          : await execution.observe(now, base.reservations);
      const reconciled = reconcilePortfolio(
        policy,
        strategy,
        base,
        observation,
      );
      for (const intent of base.closing) {
        if (
          !observation.positions.some(
            (p) => p.symbol === intent.position.symbol,
          )
        )
          await execution.confirmClosed?.(intent, observation.asOf);
      }
      const changed = change(reconciled, observation);
      const next = { ...changed.state, revision: base.revision + 1 };
      if (await store.compare(previous, next)) {
        cache = { revision: next.revision, bucket, observation };
        return { state: next, observation, result: changed.result };
      }
      cache = undefined;
    }
    throw new Error('Portfolio state contention; entry was not submitted');
  }
  async function tick(now: number, force = false) {
    const claimed = await transact(
      now,
      (state, observation) => {
        const commands = portfolioCloseCommands(policy, state, observation);
        return {
          state: {
            ...state,
            closing: state.closing.map((c) =>
              commands.some((x) => x.intent.positionId === c.positionId)
                ? { ...c, lastAttemptAt: observation.asOf }
                : c,
            ),
          },
          result: commands,
        };
      },
      force,
    );
    for (const command of claimed.result)
      await execution.close(
        command.position,
        command.intent,
        claimed.observation.asOf,
      );
    if (claimed.result.length) {
      cache = undefined;
      const refreshed = await transact(
        now,
        (state) => ({ state, result: undefined }),
        true,
      );
      return buildPortfolioContext(
        policy,
        strategy,
        refreshed.state,
        refreshed.observation,
      );
    }
    return buildPortfolioContext(
      policy,
      strategy,
      claimed.state,
      claimed.observation,
    );
  }
  async function updateReservation(
    now: number,
    id: string,
    submitted: boolean,
    qty?: number,
  ) {
    return transact(
      now,
      (s, o) => {
        const exists = s.reservations.some((r) => r.id === id);
        const blocked =
          submitted &&
          (!exists || s.closing.length > 0 || o.asOf <= s.blockedThrough);
        return {
          state: {
            ...s,
            reservations: s.reservations.flatMap((r) =>
              r.id !== id
                ? [r]
                : submitted && !blocked
                  ? [{ ...r, submitted: true, qty: qty ?? r.qty }]
                  : [],
            ),
          },
          result: !blocked,
        };
      },
      true,
    );
  }
  return {
    async context(now: number) {
      const state = (await store.read()) ?? createPortfolioState(fingerprint);
      if (state.fingerprint !== fingerprint)
        throw new Error('Portfolio policy changed under existing state');
      const observation = await execution.observe(now, state.reservations);
      validatePortfolioObservation(observation);
      return buildPortfolioContext(policy, strategy, state, observation);
    },
    tick,
    async submit<T>(
      now: number,
      entry: Omit<PortfolioReservation, 'submitted' | 'oppositeHandled'>,
      send: (
        markSubmitted: (qty: number) => Promise<void>,
        markRejected: () => Promise<void>,
      ) => Promise<T>,
    ): Promise<{ reason?: string; value?: T }> {
      await tick(now);
      const admitted = await transact(
        now,
        (s, o) => {
          const r = reservePortfolioEntry(policy, strategy, s, o, {
            ...entry,
            submitted: false,
            oppositeHandled: false,
          });
          return { state: r.state, result: r.reason };
        },
        true,
      );
      if (admitted.result) return { reason: admitted.result };
      let submitted = false;
      try {
        const value = await send(
          async (qty) => {
            if (!Number.isFinite(qty) || qty <= 0)
              throw new Error('Invalid submitted portfolio quantity');
            submitted = true;
            const update = await updateReservation(now, entry.id, true, qty);
            if (!update.result)
              throw new Error('PORTFOLIO_SUBMISSION_NO_LONGER_ADMITTED');
          },
          async () => {
            await transact(
              now,
              (s) => ({
                state: {
                  ...s,
                  reservations: s.reservations.filter((r) => r.id !== entry.id),
                  completedSignals: {
                    ...s.completedSignals,
                    [entry.signalId]: now,
                  },
                },
                result: undefined,
              }),
              true,
            );
          },
        );
        if (!submitted) await updateReservation(now, entry.id, false);
        else await tick(now, true);
        return { value };
      } catch (error) {
        if (!submitted) await updateReservation(now, entry.id, false);
        throw error;
      }
    },
  };
}
export type PortfolioCoordinator = ReturnType<
  typeof createPortfolioCoordinator
>;

/** Isolated per replay session, never a global registry. */
export function createMemoryPortfolioStore(): PortfolioStateStore {
  let state: PortfolioState | null = null;
  return {
    read: async () => (state === null ? null : structuredClone(state)),
    compare: async (expected, next) => {
      if ((state?.revision ?? -1) !== (expected?.revision ?? -1)) return false;
      state = structuredClone(next);
      return true;
    },
  };
}
