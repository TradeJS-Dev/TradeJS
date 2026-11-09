import type {
  PortfolioPolicyConfig,
  PortfolioState,
  PortfolioObservation,
  PortfolioPosition,
  PortfolioContext,
  PortfolioReservation,
} from '@tradejs/types';
const DAY = 86_400_000;
const positive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export function parsePortfolioPolicy(
  value: unknown,
): PortfolioPolicyConfig | undefined {
  if (value === undefined || value === null || value === false)
    return undefined;
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(value.id) ||
    !positive(value.riskUnit) ||
    !Number.isSafeInteger(value.observationIntervalMs) ||
    !positive(value.observationIntervalMs) ||
    !Number.isSafeInteger(value.maxPriceAgeMs) ||
    !positive(value.maxPriceAgeMs)
  )
    throw new Error(
      'Invalid portfolio policy identity, risk or observation clock',
    );
  const scope = value.scope;
  if (
    scope !== 'strategy' &&
    scope !== 'account' &&
    !(
      record(scope) &&
      Object.keys(scope).length === 1 &&
      Array.isArray(scope.strategies) &&
      scope.strategies.length &&
      scope.strategies.every((s) => typeof s === 'string' && s.trim()) &&
      new Set(scope.strategies).size === scope.strategies.length
    )
  )
    throw new Error('Invalid portfolio scope');
  if (
    value.maxPositions !== undefined &&
    (!positive(value.maxPositions) || !Number.isSafeInteger(value.maxPositions))
  )
    throw new Error('Invalid portfolio position limit');
  if (
    value.closeOppositeOnFill !== undefined &&
    typeof value.closeOppositeOnFill !== 'boolean'
  )
    throw new Error('Invalid opposite-fill policy');
  const profit = value.profitExit;
  if (
    profit !== undefined &&
    (!record(profit) ||
      (profit.scope !== 'position' && profit.scope !== 'basket') ||
      Object.keys(profit).some(
        (k) => !['scope', 'multiple', 'minPositions'].includes(k),
      ) ||
      !positive(profit.multiple) ||
      (profit.minPositions !== undefined &&
        (!positive(profit.minPositions) ||
          !Number.isSafeInteger(profit.minPositions))))
  )
    throw new Error('Invalid portfolio profit exit');
  const allowed = new Set([
    'id',
    'scope',
    'riskUnit',
    'observationIntervalMs',
    'maxPriceAgeMs',
    'maxPositions',
    'profitExit',
    'closeOppositeOnFill',
  ]);
  if (
    value.maxPositions === undefined &&
    profit === undefined &&
    value.closeOppositeOnFill !== true
  )
    throw new Error('Portfolio policy has no enabled rules');
  if (Object.keys(value).some((k) => !allowed.has(k)))
    throw new Error('Unknown portfolio policy option');
  return {
    id: value.id,
    scope: scope as PortfolioPolicyConfig['scope'],
    riskUnit: value.riskUnit,
    observationIntervalMs: value.observationIntervalMs,
    maxPriceAgeMs: value.maxPriceAgeMs,
    ...(value.maxPositions !== undefined
      ? { maxPositions: value.maxPositions as number }
      : {}),
    ...(record(profit)
      ? {
          profitExit: {
            scope: profit.scope as 'position' | 'basket',
            multiple: profit.multiple as number,
            ...(profit.minPositions !== undefined
              ? { minPositions: profit.minPositions as number }
              : {}),
          },
        }
      : {}),
    ...(value.closeOppositeOnFill !== undefined
      ? { closeOppositeOnFill: value.closeOppositeOnFill }
      : {}),
  };
}
export function portfolioFingerprint(
  policy: PortfolioPolicyConfig,
  strategy: string,
): string {
  return JSON.stringify({
    ...policy,
    scope:
      policy.scope === 'strategy'
        ? { strategies: [strategy] }
        : policy.scope === 'account'
          ? 'account'
          : { strategies: [...policy.scope.strategies].sort() },
  });
}
export function createPortfolioState(fingerprint: string): PortfolioState {
  return {
    schema: 'tradejs-portfolio/v1',
    revision: 0,
    fingerprint,
    reservations: [],
    closing: [],
    completedSignals: {},
    observedAt: -1,
    evaluatedAt: -1,
    blockedThrough: -1,
  };
}
export function portfolioOwns(
  policy: PortfolioPolicyConfig,
  strategy: string,
  owner: string | null,
): boolean {
  return (
    owner !== null &&
    (policy.scope === 'account' ||
      (policy.scope === 'strategy'
        ? owner === strategy
        : policy.scope.strategies.includes(owner)))
  );
}
export function validatePortfolioObservation(
  o: unknown,
): asserts o is PortfolioObservation {
  if (
    !record(o) ||
    !Number.isSafeInteger(o.asOf) ||
    Number(o.asOf) < 0 ||
    !Array.isArray(o.positions) ||
    !Array.isArray(o.orders)
  )
    throw new Error('Invalid portfolio observation');
  const ids = new Set<string>(),
    symbols = new Set<string>();
  for (const p of o.positions) {
    if (!record(p)) throw new Error('Invalid portfolio position');
    const key = `${p.symbol}:${p.direction}`;
    if (
      typeof p.id !== 'string' ||
      !p.id ||
      typeof p.symbol !== 'string' ||
      !p.symbol ||
      !['LONG', 'SHORT'].includes(String(p.direction)) ||
      !positive(p.qty) ||
      !positive(p.entryPrice) ||
      ids.has(p.id) ||
      symbols.has(key) ||
      (p.strategy !== null &&
        (typeof p.strategy !== 'string' || !p.strategy)) ||
      (p.markPrice !== null && !positive(p.markPrice)) ||
      (p.markedAt !== null &&
        (!Number.isSafeInteger(p.markedAt) || Number(p.markedAt) < 0))
    )
      throw new Error('Invalid or duplicate portfolio position');
    ids.add(p.id);
    symbols.add(key);
  }
  const orders = new Set<string>();
  for (const order of o.orders) {
    if (
      !record(order) ||
      typeof order.id !== 'string' ||
      !order.id ||
      orders.has(order.id) ||
      !['pending', 'partial', 'filled', 'cancelled', 'rejected'].includes(
        String(order.status),
      ) ||
      !Number.isFinite(order.filledQty) ||
      Number(order.filledQty) < 0
    )
      throw new Error('Invalid portfolio order observation');
    orders.add(order.id);
  }
}
const fresh = (
  p: PortfolioPosition,
  o: PortfolioObservation,
  policy: PortfolioPolicyConfig,
) =>
  p.markPrice !== null &&
  p.markedAt !== null &&
  p.markedAt <= o.asOf &&
  o.asOf - p.markedAt <= policy.maxPriceAgeMs;
const pnl = (p: PortfolioPosition) =>
  ((p.markPrice ?? p.entryPrice) - p.entryPrice) *
  p.qty *
  (p.direction === 'LONG' ? 1 : -1);
export function buildPortfolioContext(
  policy: PortfolioPolicyConfig,
  strategy: string,
  state: PortfolioState,
  o: PortfolioObservation,
): PortfolioContext {
  const positions = o.positions.filter((p) =>
    portfolioOwns(policy, strategy, p.strategy),
  );
  const complete = positions.every((p) => fresh(p, o, policy));
  const value = positions.reduce((s, p) => s + p.qty * p.entryPrice, 0);
  const risksKnown = positions.every((p) => positive(p.stopLossPrice));
  return {
    schema: 'tradejs-portfolio-context/v1',
    asOf: o.asOf,
    policyId: policy.id,
    positionCount: positions.length,
    pendingEntryCount: state.reservations.filter(
      (r) =>
        !positions.some(
          (p) => p.symbol === r.symbol && p.direction === r.direction,
        ),
    ).length,
    longCount: positions.filter((p) => p.direction === 'LONG').length,
    shortCount: positions.filter((p) => p.direction === 'SHORT').length,
    grossUnrealizedPnlR: complete
      ? positions.reduce((s, p) => s + pnl(p), 0) / policy.riskUnit
      : null,
    openStopRiskR: risksKnown
      ? positions.reduce(
          (s, p) =>
            s +
            Math.max(
              0,
              (p.entryPrice - (p.stopLossPrice ?? p.entryPrice)) *
                (p.direction === 'LONG' ? 1 : -1),
            ) *
              p.qty,
          0,
        ) / policy.riskUnit
      : null,
    largestPositionShare:
      value > 0
        ? Math.max(...positions.map((p) => (p.qty * p.entryPrice) / value))
        : null,
    pricesComplete: complete,
    unknownOwnershipCount: o.positions.filter((p) => p.strategy === null)
      .length,
  };
}
/** Reconcile exchange facts before making decisions. Acknowledgement alone is never a fill. */
export function reconcilePortfolio(
  policy: PortfolioPolicyConfig,
  strategy: string,
  previous: PortfolioState,
  o: PortfolioObservation,
): PortfolioState {
  validatePortfolioObservation(o);
  if (o.asOf < previous.observedAt)
    throw new Error('Portfolio observation moved backwards');
  const state: PortfolioState = {
    ...previous,
    reservations: previous.reservations.map((r) => ({ ...r })),
    closing: previous.closing.map((c) => ({ ...c })),
    completedSignals: { ...previous.completedSignals },
    observedAt: o.asOf,
  };
  const cycle =
    Math.floor(o.asOf / policy.observationIntervalMs) *
    policy.observationIntervalMs;
  const positions = o.positions.filter((p) =>
    portfolioOwns(policy, strategy, p.strategy),
  );
  const closingBefore = state.closing.length;
  state.closing = state.closing.filter((c) =>
    positions.some((p) => p.id === c.positionId),
  );
  if (state.closing.length < closingBefore)
    state.blockedThrough = Math.max(
      state.blockedThrough,
      cycle + policy.observationIntervalMs - 1,
    );
  const requestClose = (
    p: PortfolioPosition,
    reason: PortfolioState['closing'][number]['reason'],
  ) => {
    if (!state.closing.some((c) => c.positionId === p.id))
      state.closing.push({
        positionId: p.id,
        position: { ...p },
        reason,
        createdAt: o.asOf,
        lastAttemptAt: null,
      });
  };
  state.reservations = state.reservations.filter((r) => {
    const order = o.orders.find((x) => x.id === r.id);
    if (!order) return true;
    if (order.filledQty > 0 && !r.oppositeHandled) {
      const filled = positions.find(
        (p) =>
          p.id === order.positionId &&
          p.symbol === r.symbol &&
          p.direction === r.direction,
      );
      if (filled) {
        r.oppositeHandled = true;
        if (policy.closeOppositeOnFill)
          for (const p of positions)
            if (p.id !== filled.id && p.direction !== r.direction)
              requestClose(p, 'PORTFOLIO_OPPOSITE_FILL');
      }
    }
    if (['filled', 'cancelled', 'rejected'].includes(order.status)) {
      if (order.filledQty > 0 && !r.oppositeHandled) return true;
      state.completedSignals[r.signalId] = o.asOf;
      return false;
    }
    return true;
  });
  if (cycle > state.evaluatedAt) {
    state.evaluatedAt = cycle;
    const profit = policy.profitExit;
    if (profit?.scope === 'position')
      for (const p of positions)
        if (fresh(p, o, policy) && pnl(p) >= profit.multiple * policy.riskUnit)
          requestClose(p, 'PORTFOLIO_PROFIT_POSITION');
    if (
      profit?.scope === 'basket' &&
      positions.length >= (profit.minPositions ?? 2) &&
      positions.every((p) => fresh(p, o, policy)) &&
      positions.reduce((sum, p) => sum + pnl(p), 0) >=
        profit.multiple * policy.riskUnit
    )
      for (const p of positions) requestClose(p, 'PORTFOLIO_PROFIT_BASKET');
  }
  for (const [id, t] of Object.entries(state.completedSignals))
    if (t < o.asOf - 7 * DAY) delete state.completedSignals[id];
  return state;
}
export function reservePortfolioEntry(
  policy: PortfolioPolicyConfig,
  strategy: string,
  state: PortfolioState,
  o: PortfolioObservation,
  entry: PortfolioReservation,
): { state: PortfolioState; reason?: string } {
  if (!portfolioOwns(policy, strategy, entry.strategy))
    return { state, reason: 'PORTFOLIO_OUTSIDE_SCOPE' };
  if (
    !positive(entry.qty) ||
    !entry.symbol ||
    !['LONG', 'SHORT'].includes(entry.direction) ||
    !entry.id ||
    !entry.signalId ||
    !Number.isSafeInteger(entry.timestamp) ||
    entry.timestamp < o.asOf - 7 * DAY ||
    entry.timestamp > o.asOf
  )
    return { state, reason: 'PORTFOLIO_INVALID_ENTRY' };
  if (
    state.reservations.some(
      (r) => r.signalId === entry.signalId || r.id === entry.id,
    ) ||
    state.completedSignals[entry.signalId] !== undefined
  )
    return { state, reason: 'PORTFOLIO_DUPLICATE_ENTRY' };
  if (state.closing.length || o.asOf <= state.blockedThrough)
    return { state, reason: 'PORTFOLIO_CLOSING' };
  if (
    o.positions.some((p) => p.symbol === entry.symbol) ||
    state.reservations.some((p) => p.symbol === entry.symbol)
  )
    return { state, reason: 'PORTFOLIO_SYMBOL_OCCUPIED' };
  const context = buildPortfolioContext(policy, strategy, state, o);
  if (context.unknownOwnershipCount)
    return { state, reason: 'PORTFOLIO_UNKNOWN_OWNERSHIP' };
  if (
    policy.maxPositions !== undefined &&
    context.positionCount + context.pendingEntryCount >= policy.maxPositions
  )
    return { state, reason: 'PORTFOLIO_POSITION_LIMIT' };
  return {
    state: { ...state, reservations: [...state.reservations, { ...entry }] },
  };
}
export function portfolioCloseCommands(
  policy: PortfolioPolicyConfig,
  state: PortfolioState,
  o: PortfolioObservation,
) {
  const cycle =
    Math.floor(o.asOf / policy.observationIntervalMs) *
    policy.observationIntervalMs;
  return state.closing.flatMap((intent) => {
    const position = o.positions.find((p) => p.id === intent.positionId);
    return position &&
      fresh(position, o, policy) &&
      (intent.lastAttemptAt === null || intent.lastAttemptAt < cycle)
      ? [{ intent, position }]
      : [];
  });
}

/** Persisted state is an IO boundary, not a trusted TypeScript object. */
export function assertPortfolioState(
  value: unknown,
): asserts value is PortfolioState {
  const fail = () => {
    throw new Error('Invalid persisted portfolio state');
  };
  if (
    !record(value) ||
    value.schema !== 'tradejs-portfolio/v1' ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    typeof value.fingerprint !== 'string' ||
    !value.fingerprint ||
    !Array.isArray(value.reservations) ||
    !Array.isArray(value.closing) ||
    !record(value.completedSignals)
  )
    return fail();
  for (const clock of [
    value.observedAt,
    value.evaluatedAt,
    value.blockedThrough,
  ])
    if (!Number.isSafeInteger(clock) || Number(clock) < -1) return fail();
  const ids = new Set<string>();
  for (const r of value.reservations) {
    if (
      !record(r) ||
      typeof r.id !== 'string' ||
      !r.id ||
      ids.has(r.id) ||
      typeof r.signalId !== 'string' ||
      !r.signalId ||
      typeof r.symbol !== 'string' ||
      !r.symbol ||
      typeof r.strategy !== 'string' ||
      !r.strategy ||
      !['LONG', 'SHORT'].includes(String(r.direction)) ||
      !positive(r.qty) ||
      !Number.isSafeInteger(r.timestamp) ||
      Number(r.timestamp) < 0 ||
      typeof r.submitted !== 'boolean' ||
      typeof r.oppositeHandled !== 'boolean'
    )
      return fail();
    ids.add(r.id);
  }
  const closes = new Set<string>();
  for (const c of value.closing) {
    if (
      !record(c) ||
      typeof c.positionId !== 'string' ||
      closes.has(c.positionId) ||
      !record(c.position) ||
      c.position.id !== c.positionId ||
      ![
        'PORTFOLIO_PROFIT_POSITION',
        'PORTFOLIO_PROFIT_BASKET',
        'PORTFOLIO_OPPOSITE_FILL',
      ].includes(String(c.reason)) ||
      !Number.isSafeInteger(c.createdAt) ||
      Number(c.createdAt) < 0 ||
      (c.lastAttemptAt !== null &&
        (!Number.isSafeInteger(c.lastAttemptAt) || Number(c.lastAttemptAt) < 0))
    )
      return fail();
    validatePortfolioObservation({
      asOf: Number(c.createdAt),
      positions: [c.position],
      orders: [],
    });
    closes.add(c.positionId);
  }
  for (const t of Object.values(value.completedSignals))
    if (!Number.isSafeInteger(t) || Number(t) < 0) return fail();
}
