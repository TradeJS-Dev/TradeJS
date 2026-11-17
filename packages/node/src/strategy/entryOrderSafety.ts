import { createHash, randomUUID } from 'node:crypto';
import { entrySafetyStorage } from '@tradejs/infra/redis';
import type {
  Connector,
  Direction,
  PortfolioOrderObservation,
} from '@tradejs/types';

const nestedSafety = new WeakMap<
  Connector,
  { failed: boolean; error?: unknown }
>();

const ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 5_000;

async function bounded<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('ENTRY_OBSERVATION_TIMEOUT')),
          REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function poll<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const value = await bounded(read());
      if (accept(value)) return value;
    } catch (error) {
      last = error;
    }
    if (attempt + 1 < ATTEMPTS)
      await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('ENTRY_RECONCILIATION_UNRESOLVED', { cause: last });
}

export function entrySafetyKey(
  connector: Connector,
  userName: string,
  symbol: string,
): string {
  // Deployment and strategy intentionally share the account's symbol safety boundary.
  return createHash('sha256')
    .update(
      JSON.stringify([userName, connector.accountId ?? 'default', symbol]),
    )
    .digest('hex');
}

export function entryCompensationId(
  connector: Connector,
  userName: string,
  symbol: string,
  orderId: string,
): string {
  return `${entrySafetyKey(connector, userName, symbol)}:${orderId}`;
}

const terminal = (order: PortfolioOrderObservation | null): boolean =>
  order !== null && ['filled', 'cancelled', 'rejected'].includes(order.status);

/** A receipt remains authoritative when exchange history no longer contains the order. */
export async function getEntryCompensation(
  connector: Connector,
  userName: string,
  symbol: string,
  orderId: string,
): Promise<PortfolioOrderObservation | null> {
  const raw = await entrySafetyStorage.readCompensation(
    entryCompensationId(connector, userName, symbol, orderId),
  );
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    value.id !== orderId ||
    !('status' in value) ||
    !['filled', 'cancelled', 'rejected'].includes(String(value.status)) ||
    !('filledQty' in value) ||
    typeof value.filledQty !== 'number' ||
    !Number.isFinite(value.filledQty) ||
    value.filledQty < 0 ||
    !('compensated' in value) ||
    value.compensated !== true
  )
    throw new Error('Invalid entry compensation receipt');
  return {
    id: orderId,
    status: value.status as PortfolioOrderObservation['status'],
    filledQty: value.filledQty,
    compensated: true,
  };
}

/** Live entry lifecycle; synchronous simulation connectors keep their existing semantics. */
export async function withEntryOrderSafety<T>({
  connector,
  userName,
  symbol,
  direction,
  orderId,
  execute,
}: {
  connector: Connector;
  userName?: string;
  symbol: string;
  direction: Direction;
  orderId: string;
  execute: (connector: Connector) => Promise<T>;
}): Promise<T> {
  const inherited = nestedSafety.get(connector);
  if (inherited) {
    try {
      return await execute(connector);
    } catch (error) {
      inherited.failed = true;
      inherited.error = error;
      throw error;
    }
  }
  if (!connector.cancelEntryOrder && !connector.getEntryPositionObservation)
    return execute(connector);
  if (
    !connector.cancelEntryOrder ||
    !connector.getEntryPositionObservation ||
    !connector.getEntryOrderObservation ||
    !userName
  )
    throw new Error('ENTRY_SAFETY_UNAVAILABLE');
  const key = entrySafetyKey(connector, userName, symbol);
  let claim: string | undefined;
  let terminalEntry: PortfolioOrderObservation | undefined;
  let admittedId = orderId;
  let submissionStarted = false;
  const sentOrderIds: string[] = [];
  const rejectedOrderIds: string[] = [];
  const closeOrderIds: string[] = [];
  let submittedOrder: Parameters<Connector['placeOrder']>[0] | undefined;
  const position = () => connector.getEntryPositionObservation!({ symbol });
  const order = async () => {
    const fact = await connector.getEntryOrderObservation!({
      symbol,
      orderId: admittedId,
    });
    return fact?.id === admittedId ? fact : null;
  };
  const settle = async (compensated = false) => {
    if (!claim) return;
    if (
      !(await entrySafetyStorage.settle(
        key,
        claim,
        compensated
          ? entryCompensationId(connector, userName, symbol, admittedId)
          : undefined,
        compensated
          ? JSON.stringify({ ...terminalEntry, compensated: true })
          : undefined,
      ))
    )
      throw new Error('ENTRY_SAFETY_CLAIM_LOST');
    claim = undefined;
  };
  const updateClaim = async (updates: Record<string, unknown>) => {
    const expected = claim;
    if (!expected) throw new Error('ENTRY_SAFETY_CLAIM_LOST');
    const next: string = JSON.stringify({
      ...JSON.parse(expected),
      ...updates,
    });
    if (!(await entrySafetyStorage.replace(key, expected, next)))
      throw new Error('ENTRY_SAFETY_CLAIM_LOST');
    claim = next;
  };
  const verifyProtection = async (stopLossPrice: number | null) => {
    const observed = await poll(position, (p) => {
      if (!p) return true;
      if (p.direction !== direction) return false;
      if (stopLossPrice == null) return true;
      const tick = p.priceTickSize;
      if (
        !Number.isFinite(tick) ||
        tick <= 0 ||
        !Number.isFinite(p.slPrice) ||
        !p.slPrice ||
        p.slPrice <= 0
      )
        return false;
      const ticks = stopLossPrice / tick;
      const expected =
        (direction === 'LONG' ? Math.floor(ticks) : Math.ceil(ticks)) * tick;
      return Math.abs(p.slPrice - expected) <= tick * 1e-6;
    });
    await settle(!observed);
    if (!observed) throw new Error('ENTRY_ALREADY_FLAT');
  };
  const safeConnector: Connector = {
    ...connector,
    getPosition: async (requestedSymbol) =>
      requestedSymbol === symbol
        ? bounded(position())
        : connector.getPosition(requestedSymbol),
    placeOrder: async (request) => {
      submittedOrder = request;
      const accepted = await connector.placeOrder({
        ...request,
        orderId: admittedId,
        beforeSubmit: async (context) => {
          const nextId = await request.beforeSubmit?.({
            ...context,
            beforeAdmission: async (id) => {
              if (sentOrderIds.includes(id))
                throw new Error('ENTRY_ORDER_ID_REUSED');
              await updateClaim({ phase: 'admitting', plannedOrderId: id });
            },
          });
          if (typeof nextId === 'string') {
            if (sentOrderIds.includes(nextId))
              throw new Error('ENTRY_ORDER_ID_REUSED');
            admittedId = nextId;
          } else if (sentOrderIds.includes(admittedId)) {
            admittedId = `tjs-r-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
          }
          const nextClaim = JSON.stringify({
            schema: 'tradejs-entry-safety/v2',
            token: randomUUID(),
            orderId: admittedId,
            symbol,
            direction,
            timestamp: request.timestamp,
            phase: 'submitted',
            originalOrderId: orderId,
            plannedOrderId: admittedId,
            sentOrderIds: [...new Set([...sentOrderIds, admittedId])],
            rejectedOrderIds,
            closeOrderIds,
          });
          if (
            !claim ||
            !(await entrySafetyStorage.replace(key, claim, nextClaim))
          ) {
            throw new Error('ENTRY_SAFETY_CLAIM_LOST');
          }
          claim = nextClaim;
          if (!sentOrderIds.includes(admittedId)) sentOrderIds.push(admittedId);
          submissionStarted = true;
          return admittedId;
        },
        onRejected: async (retrying) => {
          if (claim) {
            await updateClaim({
              rejectedOrderIds: [...new Set([...rejectedOrderIds, admittedId])],
            });
            if (!rejectedOrderIds.includes(admittedId))
              rejectedOrderIds.push(admittedId);
          }
          submissionStarted = false;
          // Keep the account/symbol claim while the adapter prepares a quantity retry.
          if (!retrying) await settle();
          await request.onRejected?.(retrying);
        },
      });
      if (!accepted) {
        // false with no explicit rejection after submission is an unknown outcome.
        if (claim && submissionStarted)
          throw new Error('ENTRY_SUBMISSION_UNCONFIRMED');
        await settle();
        return false;
      }
      if (!claim || !submissionStarted) {
        submissionStarted = true;
        throw new Error('ENTRY_SUBMISSION_NOT_GUARDED');
      }
      const fact = await poll(order, terminal);
      terminalEntry = fact ?? undefined;
      if (!fact || fact.filledQty <= 0) {
        await settle();
        throw new Error('ENTRY_NOT_FILLED');
      }
      await poll(position, (p) =>
        Boolean(p && p.direction === direction && p.qty > 0 && p.price > 0),
      );
      return true;
    },
    ...(connector.setPositionProtection
      ? {
          setPositionProtection: async (params) => {
            const accepted = await connector.setPositionProtection!(params);
            if (accepted) await verifyProtection(params.stopLossPrice);
            return accepted;
          },
        }
      : {}),
    setStopLoss: async (params) => {
      const accepted = await connector.setStopLoss(params);
      if (accepted) await verifyProtection(params.stopLossPrice);
      return accepted;
    },
  };
  const nested = { failed: false } as { failed: boolean; error?: unknown };
  nestedSafety.set(safeConnector, nested);
  const preparedClaim = JSON.stringify({
    schema: 'tradejs-entry-safety/v2',
    token: randomUUID(),
    orderId: admittedId,
    symbol,
    direction,
    timestamp: Date.now(),
    phase: 'prepared',
    originalOrderId: orderId,
    plannedOrderId: orderId,
    sentOrderIds,
    rejectedOrderIds,
    closeOrderIds,
  });
  // Claim before invoking the adapter: leverage preparation itself can mutate exchange state.
  if (!(await entrySafetyStorage.claim(key, preparedClaim)))
    throw new Error('ENTRY_RECOVERY_REQUIRED');
  claim = preparedClaim;
  try {
    const result = await execute(safeConnector);
    if (nested.failed) throw nested.error;
    await settle();
    return result;
  } catch (originalError) {
    if (!claim) throw originalError;
    if (!submissionStarted) {
      try {
        await submittedOrder?.onRejected?.(true);
        await settle();
      } catch (cleanupError) {
        throw new AggregateError(
          [originalError, cleanupError],
          'ENTRY_PROTECTION_UNRESOLVED',
        );
      }
      throw originalError;
    }
    try {
      // Cancel acknowledgements and transport errors are not terminal facts.
      try {
        await bounded(
          connector.cancelEntryOrder({ symbol, orderId: admittedId }),
        );
      } catch {
        /* Reconcile authoritative state below. */
      }
      terminalEntry = (await poll(order, terminal)) ?? undefined;
      let remaining = await bounded(position());
      for (let attempt = 0; remaining && attempt < ATTEMPTS; attempt++) {
        if (remaining.direction !== direction)
          throw new Error('ENTRY_POSITION_DIRECTION_CHANGED');
        const closeId = `tjs-x-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
        await updateClaim({ closeOrderIds: [...closeOrderIds, closeId] });
        closeOrderIds.push(closeId);
        let closeRejected = false;
        try {
          closeRejected = !(await bounded(
            connector.closePosition({
              symbol,
              direction,
              orderId: closeId,
              price: remaining.price,
              timestamp: submittedOrder?.timestamp ?? Date.now(),
            }),
          ));
        } catch {
          /* The close may still execute after a transport timeout. */
        }
        if (closeRejected) {
          await updateClaim({
            rejectedOrderIds: [...rejectedOrderIds, closeId],
          });
          rejectedOrderIds.push(closeId);
        }
        if (!closeRejected) {
          // A late reduce-only close must not leak into the next entry lifecycle.
          await poll(
            () =>
              connector.getEntryOrderObservation!({ symbol, orderId: closeId }),
            (fact) => terminal(fact) && fact?.id === closeId,
          );
        }
        try {
          remaining = await poll(position, (p) => p === null);
        } catch {
          remaining = await bounded(position());
        }
      }
      if (remaining) throw new Error('ENTRY_FLATTEN_UNCONFIRMED');
      await settle(true);
    } catch (recoveryError) {
      throw new AggregateError(
        [originalError, recoveryError],
        'ENTRY_PROTECTION_UNRESOLVED',
      );
    }
    throw originalError;
  }
}

type EntrySafetyRecoveryContext = {
  connector: Connector;
  userName: string;
  symbol: string;
};

/** Read the exact durable claim for an operator recovery request. Does not contact the exchange. */
export async function inspectEntryOrderSafety({
  connector,
  userName,
  symbol,
}: EntrySafetyRecoveryContext): Promise<string | null> {
  return entrySafetyStorage.read(entrySafetyKey(connector, userName, symbol));
}

/**
 * Supported operator recovery API, exported from @tradejs/node/strategies.
 * First stop every writer for this account/symbol and wait for their in-flight RPCs to end.
 * Then inspectEntryOrderSafety and supply that exact snapshot with writersStopped: true.
 * This function only reads exchange state. It sends no cancel, close, stop or entry request.
 * Only complete v2 journals with terminal evidence for EVERY sent ID and fresh flatness clear.
 * A complete prepared journal proves no order was sent; fresh flatness still is required.
 * v1, unknown, malformed or changed records stay blocked. Never delete claims manually.
 */
export async function recoverEntryOrderSafety({
  connector,
  userName,
  symbol,
  expectedClaim,
  writersStopped,
}: EntrySafetyRecoveryContext & {
  expectedClaim: string;
  writersStopped: true;
}): Promise<void> {
  if (
    writersStopped !== true ||
    !connector.getEntryOrderObservation ||
    !connector.getEntryPositionObservation
  )
    throw new Error('ENTRY_RECOVERY_UNAVAILABLE');
  const key = entrySafetyKey(connector, userName, symbol);
  if ((await entrySafetyStorage.read(key)) !== expectedClaim)
    throw new Error('ENTRY_SAFETY_CLAIM_LOST');
  const value: unknown = JSON.parse(expectedClaim);
  const record = value as Record<string, unknown> | null;
  const ids = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.every((id) => typeof id === 'string' && id.trim().length > 0) &&
    new Set(v).size === v.length;
  if (
    !record ||
    typeof record !== 'object' ||
    record.schema !== 'tradejs-entry-safety/v2' ||
    !['prepared', 'admitting', 'submitted'].includes(String(record.phase)) ||
    record.symbol !== symbol ||
    !['LONG', 'SHORT'].includes(String(record.direction)) ||
    typeof record.token !== 'string' ||
    !record.token ||
    typeof record.originalOrderId !== 'string' ||
    !record.originalOrderId ||
    typeof record.plannedOrderId !== 'string' ||
    !record.plannedOrderId ||
    typeof record.orderId !== 'string' ||
    !ids(record.sentOrderIds) ||
    !ids(record.closeOrderIds) ||
    !ids(record.rejectedOrderIds)
  )
    throw new Error('ENTRY_RECOVERY_INCOMPLETE_JOURNAL');
  const prepared = record.phase === 'prepared';
  const unsent = record.phase !== 'submitted';
  if (
    prepared
      ? record.sentOrderIds.length !== 0 ||
        record.closeOrderIds.length !== 0 ||
        record.rejectedOrderIds.length !== 0 ||
        record.orderId !== record.originalOrderId ||
        record.plannedOrderId !== record.originalOrderId
      : record.phase === 'submitted' &&
        (!record.sentOrderIds.length ||
          !record.sentOrderIds.includes(record.orderId) ||
          record.plannedOrderId !== record.orderId)
  )
    throw new Error('ENTRY_RECOVERY_INCOMPLETE_JOURNAL');
  const sent = [...record.sentOrderIds, ...record.closeOrderIds];
  if (record.rejectedOrderIds.some((id) => !sent.includes(id)))
    throw new Error('ENTRY_RECOVERY_INCOMPLETE_JOURNAL');
  let entry: PortfolioOrderObservation | undefined;
  for (const id of sent) {
    const fact = record.rejectedOrderIds.includes(id)
      ? { id, status: 'rejected' as const, filledQty: 0 }
      : await poll(
          () => connector.getEntryOrderObservation!({ symbol, orderId: id }),
          (fact) =>
            terminal(fact) &&
            fact?.id === id &&
            Number.isFinite(fact.filledQty) &&
            fact.filledQty >= 0,
        );
    if (id === record.plannedOrderId) entry = fact ?? undefined;
  }
  if (unsent && !record.sentOrderIds.includes(record.plannedOrderId))
    entry = { id: record.plannedOrderId, status: 'rejected', filledQty: 0 };
  await poll(
    () => connector.getEntryPositionObservation!({ symbol }),
    (position) => position === null,
  );
  if (
    !entry ||
    !(await entrySafetyStorage.settle(
      key,
      expectedClaim,
      entryCompensationId(connector, userName, symbol, record.plannedOrderId),
      JSON.stringify({ ...entry, compensated: true }),
    ))
  )
    throw new Error('ENTRY_SAFETY_CLAIM_LOST');
}
