import type { Connector, Direction, Tp, Order } from '@tradejs/types';
import { logger } from '@tradejs/infra/logger';
import {
  validateEntryExecution,
  EntrySubmissionValidationError,
  type EntryExecutionLimits,
} from './entryExecutionValidation';

const MAX_ENTRY_QUOTE_AGE_MS = 5_000;

const toFiniteNumberOrNull = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const getOrderArrivalSnapshot = async ({
  connector,
  symbol,
  requireTimestamp = false,
}: {
  connector: Connector;
  symbol: string;
  requireTimestamp?: boolean;
}) => {
  if (typeof connector.getTopOfBookTicker !== 'function') {
    return {
      arrivalSnapshotTime: Date.now(),
      arrivalSource: 'unavailable',
      bid: null,
      ask: null,
      arrivalMid: null,
      spreadBps: null,
    };
  }

  try {
    const ticker = await connector.getTopOfBookTicker(symbol);
    const arrivalSnapshotTime = toFiniteNumberOrNull(ticker?.timestamp);
    const timestampUnavailable =
      requireTimestamp && arrivalSnapshotTime == null;
    const bid = timestampUnavailable
      ? null
      : toFiniteNumberOrNull(ticker?.bidPrice);
    const ask = timestampUnavailable
      ? null
      : toFiniteNumberOrNull(ticker?.askPrice);
    const arrivalMid = bid != null && ask != null ? (bid + ask) / 2 : null;
    const spreadBps =
      bid != null && ask != null && arrivalMid != null && arrivalMid > 0
        ? ((ask - bid) / arrivalMid) * 10_000
        : null;

    return {
      arrivalSnapshotTime: arrivalSnapshotTime ?? Date.now(),
      arrivalSource: 'top_of_book',
      bid,
      ask,
      arrivalMid,
      spreadBps,
    };
  } catch (error) {
    logger.warn(
      'runtime order arrival snapshot failed: %s %s',
      symbol,
      (error as Error)?.message || String(error),
    );
    return {
      arrivalSnapshotTime: Date.now(),
      arrivalSource: 'top_of_book_error',
      bid: null,
      ask: null,
      arrivalMid: null,
      spreadBps: null,
    };
  }
};

export const validateEntryProtectionAtArrival = ({
  direction,
  signalPrice,
  bid,
  ask,
  arrivalMid,
  takeProfits,
  stopLossPrice,
}: {
  direction: Direction;
  signalPrice: number;
  bid: number | null;
  ask: number | null;
  arrivalMid: number | null;
  takeProfits: Tp[];
  stopLossPrice: number | null;
}) => {
  const entryReference =
    direction === 'LONG'
      ? ask ?? arrivalMid ?? signalPrice
      : bid ?? arrivalMid ?? signalPrice;
  const stopReference =
    direction === 'LONG'
      ? bid ?? arrivalMid ?? signalPrice
      : ask ?? arrivalMid ?? signalPrice;
  if (
    !Number.isFinite(entryReference) ||
    entryReference <= 0 ||
    !Number.isFinite(stopReference) ||
    stopReference <= 0
  ) {
    throw new Error('INVALID_ENTRY_REFERENCE_AT_ARRIVAL');
  }

  for (const takeProfit of takeProfits) {
    if (
      !Number.isFinite(takeProfit.price) ||
      takeProfit.price <= 0 ||
      (direction === 'LONG'
        ? takeProfit.price <= entryReference
        : takeProfit.price >= entryReference)
    ) {
      throw new Error('TAKE_PROFIT_CROSSED_BEFORE_ENTRY');
    }
  }

  if (
    stopLossPrice != null &&
    (!Number.isFinite(stopLossPrice) ||
      stopLossPrice <= 0 ||
      (direction === 'LONG'
        ? stopLossPrice >= stopReference
        : stopLossPrice <= stopReference))
  ) {
    throw new Error('STOP_LOSS_CROSSED_BEFORE_ENTRY');
  }
};

export const createEntrySubmissionValidation = ({
  connector,
  symbol,
  direction,
  takeProfits,
  stopLossPrice,
  limits,
  onValidated,
}: {
  connector: Connector;
  symbol: string;
  direction: Direction;
  takeProfits: Tp[];
  stopLossPrice: number | null;
  limits?: EntryExecutionLimits;
  onValidated?: (
    snapshot: Awaited<ReturnType<typeof getOrderArrivalSnapshot>>,
    economics: ReturnType<typeof validateEntryExecution>,
  ) => void;
}): Order['beforeSubmit'] => {
  if (!limits) return undefined;
  if (!connector.capabilities?.orderSubmissionValidation)
    throw new EntrySubmissionValidationError(
      'ENTRY_SUBMISSION_VALIDATION_UNSUPPORTED',
    );
  return async ({ qty, executionPrice }) => {
    const simulated = Reflect.get(connector, '__tradejsTestConnector') === true;
    const snapshot =
      simulated && executionPrice != null
        ? {
            arrivalSnapshotTime: Date.now(),
            arrivalSource: 'simulation',
            bid: executionPrice,
            ask: executionPrice,
            arrivalMid: executionPrice,
            spreadBps: 0,
          }
        : await getOrderArrivalSnapshot({
            connector,
            symbol,
            requireTimestamp: true,
          });
    const age = Date.now() - snapshot.arrivalSnapshotTime;
    if (
      snapshot.bid == null ||
      snapshot.ask == null ||
      !Number.isFinite(snapshot.bid) ||
      !Number.isFinite(snapshot.ask) ||
      snapshot.bid <= 0 ||
      snapshot.ask < snapshot.bid
    )
      throw new EntrySubmissionValidationError(
        'ENTRY_QUOTE_UNAVAILABLE_AT_SUBMISSION',
      );
    if (
      !Number.isFinite(age) ||
      age < -MAX_ENTRY_QUOTE_AGE_MS ||
      age > MAX_ENTRY_QUOTE_AGE_MS
    )
      throw new EntrySubmissionValidationError(
        'ENTRY_QUOTE_STALE_AT_SUBMISSION',
      );
    const price = direction === 'LONG' ? snapshot.ask : snapshot.bid;
    validateEntryProtectionAtArrival({
      direction,
      signalPrice: price,
      bid: snapshot.bid,
      ask: snapshot.ask,
      arrivalMid: snapshot.arrivalMid,
      takeProfits,
      stopLossPrice,
    });
    const prices = takeProfits.map((tp) => tp.price);
    const economics = validateEntryExecution({
      direction,
      price,
      qty,
      stopLossPrice,
      takeProfitPrice:
        direction === 'LONG' ? Math.max(...prices) : Math.min(...prices),
      limits,
    });
    onValidated?.(snapshot, economics);
  };
};
