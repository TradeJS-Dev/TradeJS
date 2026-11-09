import { createHash } from 'node:crypto';
import {
  parsePortfolioPolicy,
  assertPortfolioState,
  portfolioFingerprint,
} from '@tradejs/core/portfolio';
import { portfolioStateStorage } from '@tradejs/infra/redis';
import type {
  Connector,
  PortfolioObservation,
  PortfolioReservation,
  PortfolioState,
  PortfolioStateStore,
} from '@tradejs/types';
import {
  createPortfolioCoordinator,
  createMemoryPortfolioStore,
  type PortfolioCoordinator,
} from '../portfolio';
import {
  getActiveRuntimeTrade,
  markRuntimeTradeClosed,
} from '../runtimeJournal';

const coordinators = new WeakMap<
  Connector,
  Map<string, { fingerprint: string; coordinator: PortfolioCoordinator }>
>();

/** Exchange facts are attributed through the journal or a reserved, confirmed execution. */
export async function observeRuntimePortfolio(
  connector: Connector,
  binding: { userName: string; accountId: string; deploymentId: string },
  asOf: number,
  reservations: readonly PortfolioReservation[],
  observedNow: () => number = Date.now,
): Promise<PortfolioObservation> {
  if (!connector.getOpenPositionPnl || !connector.getEntryExecutions)
    throw new Error(
      'Portfolio policies require position marks and entry executions',
    );
  const orders = await Promise.all(
    reservations.map(async (r) => {
      if (r.submitted && connector.getEntryOrderObservation) {
        const fact = await connector.getEntryOrderObservation({
          symbol: r.symbol,
          orderId: r.id,
        });
        if (fact) return fact;
      }
      const executions = r.submitted
        ? await connector.getEntryExecutions!({
            symbol: r.symbol,
            startTime: r.timestamp,
            endTime: asOf,
          })
        : [];
      const filledQty = executions
        .filter(
          (e) =>
            (e.orderLinkId === r.id || e.orderId === r.id) &&
            e.direction === r.direction,
        )
        .reduce((sum, e) => sum + e.qty, 0);
      return {
        id: r.id,
        status:
          filledQty >= r.qty
            ? ('filled' as const)
            : filledQty > 0
              ? ('partial' as const)
              : ('pending' as const),
        filledQty,
        positionId: r.id,
      };
    }),
  );
  const snapshots = await connector.getOpenPositionPnl();
  const positions = await Promise.all(
    snapshots.map(async (p) => {
      const reserved = reservations.find(
        (r) =>
          r.symbol === p.symbol &&
          r.direction === p.direction &&
          orders.some(
            (o) =>
              o.id === r.id &&
              o.filledQty > 0 &&
              p.qty <= o.filledQty * (1 + 1e-8),
          ),
      );
      const trade = await getActiveRuntimeTrade({
        ...binding,
        symbol: p.symbol,
      });
      const owner =
        trade &&
        trade.direction === p.direction &&
        p.qty <= trade.qty * (1 + 1e-8) &&
        Math.abs(p.price - (trade.actualEntryPrice ?? trade.entryPrice)) <=
          p.price * 1e-8
          ? trade
          : null;
      return {
        id:
          reserved?.id ??
          owner?.orderId ??
          `unknown:${p.symbol}:${p.direction}`,
        strategy: reserved?.strategy ?? owner?.strategy ?? null,
        symbol: p.symbol,
        direction: p.direction,
        qty: p.qty,
        entryPrice: p.price,
        markPrice: p.currentPrice,
        markedAt: p.observedAt ?? null,
        stopLossPrice: p.slPrice ?? p.stopLossPrice ?? null,
      };
    }),
  );
  return { asOf: Math.max(asOf, observedNow()), positions, orders };
}

function persistentStore(key: string): PortfolioStateStore {
  // Preserve exact serialized bytes for CAS; revisions alone cannot establish identity.
  const raw = new WeakMap<PortfolioState, string>();
  return {
    async read() {
      const value = await portfolioStateStorage.read(key);
      if (value === null) return null;
      const state: unknown = JSON.parse(value);
      assertPortfolioState(state);
      raw.set(state, value);
      return state;
    },
    async compare(previous, next) {
      const expected = previous === null ? null : raw.get(previous);
      if (expected === undefined)
        throw new Error('Portfolio CAS requires a storage snapshot');
      return portfolioStateStorage.compare(key, expected, JSON.stringify(next));
    },
  };
}

export function getPortfolioRuntime({
  value,
  connectorName,
  strategy,
  connector,
  env,
  userName,
  accountId,
  deploymentId,
}: {
  value: unknown;
  connectorName: string;
  strategy: string;
  connector: Connector;
  env: string;
  userName?: string;
  accountId?: string;
  deploymentId?: string;
}): PortfolioCoordinator | undefined {
  const policy = parsePortfolioPolicy(value);
  if (!policy) return undefined;
  const replay =
    (env === 'BACKTEST' || env === 'PARITY') &&
    Reflect.get(connector, '__tradejsReplayConnector') === true;
  if (
    (env === 'BACKTEST' || env === 'PARITY') &&
    (!replay || !connector.getPortfolioObservation)
  )
    throw new Error(
      'Portfolio policies require shared portfolio replay; isolated symbol backtests are unsupported',
    );
  if (
    !replay &&
    (!userName ||
      !accountId ||
      !deploymentId ||
      !connector.getOpenPositionPnl ||
      !connector.getEntryExecutions)
  )
    throw new Error(
      'Portfolio runtime requires exact user/account/deployment binding, marks and executions',
    );
  const binding = {
    userName: userName!,
    accountId: accountId!,
    deploymentId: deploymentId!,
  };
  const scope =
    policy.scope === 'strategy'
      ? strategy
      : policy.scope === 'account'
        ? 'account'
        : [...policy.scope.strategies].sort();
  const key = createHash('sha256')
    .update(JSON.stringify([binding, connectorName, connector.universe, scope]))
    .digest('hex');
  const fingerprint = portfolioFingerprint(policy, strategy);
  const cacheKey = key;
  let registry = coordinators.get(connector);
  if (!registry) {
    registry = new Map();
    coordinators.set(connector, registry);
  }
  const existing = registry.get(cacheKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      throw new Error('Conflicting portfolio configuration for the same scope');
    return existing.coordinator;
  }
  const coordinator = createPortfolioCoordinator({
    policy,
    strategy,
    store: replay ? createMemoryPortfolioStore() : persistentStore(key),
    execution: {
      async confirmClosed(intent, asOf) {
        if (replay) return;
        const position = intent.position;
        await markRuntimeTradeClosed({
          ...binding,
          strategy: position.strategy!,
          expectedOrderId: position.id,
          symbol: position.symbol,
          exitPrice: position.markPrice!,
          exitTimestamp: asOf,
          exitType: 'exit',
        });
      },
      observe: (asOf, reservations) =>
        replay
          ? connector.getPortfolioObservation!(asOf, reservations)
          : observeRuntimePortfolio(connector, binding, asOf, reservations),
      async close(position, intent, asOf) {
        // Recheck ownership immediately before submitting a close. Never close an unrelated replacement.
        if (!replay) {
          const trade = await getActiveRuntimeTrade({
            ...binding,
            symbol: position.symbol,
          });
          if (!trade || trade.orderId !== position.id)
            throw new Error('Portfolio close ownership changed');
        }
        await connector.closePosition({
          symbol: position.symbol,
          direction: position.direction,
          price: position.markPrice!,
          timestamp: asOf,
          signal: {
            signalId: `${position.id}:${intent.reason}`,
            strategy: position.strategy!,
            symbol: position.symbol,
            direction: position.direction,
            interval: '1',
            timestamp: asOf,
            prices: {
              riskRatio: 0,
              currentPrice: position.markPrice!,
              takeProfitPrice: position.markPrice!,
              stopLossPrice: position.markPrice!,
            },
            figures: {},
            indicators: {},
            additionalIndicators: { portfolioExitReason: intent.reason },
          },
        });
      },
    },
  });
  registry.set(cacheKey, { fingerprint, coordinator });
  return coordinator;
}
