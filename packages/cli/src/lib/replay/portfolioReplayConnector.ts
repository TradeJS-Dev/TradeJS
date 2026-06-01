import { FEE_PERCENT, INITIAL_BACKTEST_AMOUNT } from '@tradejs/core/constants';
import { round } from '@tradejs/core/math';
import {
  Candle,
  Connector,
  Order,
  OrderLog,
  OrderLogData,
  Position,
  PositionLog,
  PositionLogData,
  PositionPnlSnapshot,
  Signal,
  Sl,
  Tp,
} from '@tradejs/types';
const UNKNOWN_STRATEGY = '[unknown]';

type ReplayPosition = Order & {
  amount: number;
  strategyName: string;
};

type PositionState = {
  position: ReplayPosition;
  originalQty: number;
  currentProfit: number;
  takeProfits: Tp[];
  stopLossPrice: Sl;
};

type ReplayArtifacts = {
  orderLog: OrderLogData;
  positionLog: PositionLogData;
  orderLogByStrategy: Map<string, OrderLogData>;
  positionLogByStrategy: Map<string, PositionLogData>;
};

export type PortfolioReplayConnector = Connector & {
  __tradejsReplayConnector: true;
  __tradejsTestConnector: true;
  advanceMarket: (params: { symbol: string; candle: Candle }) => Promise<void>;
  getReplayArtifacts: () => ReplayArtifacts;
};

const getSignalWithoutIndicators = (signal?: Signal) => {
  if (!signal) {
    return signal;
  }

  const { indicators: _indicators, ...signalWithoutIndicators } =
    signal as unknown as Record<string, unknown>;
  return signalWithoutIndicators as unknown as Signal;
};

const getStrategyName = ({
  signal,
  fallback,
}: {
  signal?: Signal;
  fallback?: string;
}) => {
  const strategyName = signal?.strategy || fallback || UNKNOWN_STRATEGY;
  return strategyName.trim() || UNKNOWN_STRATEGY;
};

const getPositionPnlSnapshot = ({
  position,
  currentPrice,
}: {
  position: ReplayPosition;
  currentPrice: number;
}): PositionPnlSnapshot => {
  const unrealizedPnl =
    position.direction === 'LONG'
      ? (currentPrice - position.price) * position.qty
      : (position.price - currentPrice) * position.qty;

  return {
    symbol: position.symbol,
    qty: position.qty,
    price: position.price,
    currentPrice,
    unrealizedPnl: round(unrealizedPnl),
    direction: position.direction,
  };
};

export const createPortfolioReplayConnector = (
  connector: Connector,
): PortfolioReplayConnector => {
  let state = {};
  let amount = INITIAL_BACKTEST_AMOUNT;
  const positionsBySymbol = new Map<string, PositionState>();
  const currentPriceBySymbol = new Map<string, number>();
  const orderLog: OrderLogData = [];
  const positionLog: PositionLogData = [];
  const orderLogByStrategy = new Map<string, OrderLogData>();
  const positionLogByStrategy = new Map<string, PositionLogData>();

  const appendStrategyOrderLog = (strategyName: string, entry: OrderLog) => {
    const bucket = orderLogByStrategy.get(strategyName) ?? [];
    bucket.push(entry);
    orderLogByStrategy.set(strategyName, bucket);
  };

  const appendStrategyPositionLog = (
    strategyName: string,
    entry: PositionLog,
  ) => {
    const bucket = positionLogByStrategy.get(strategyName) ?? [];
    bucket.push(entry);
    positionLogByStrategy.set(strategyName, bucket);
  };

  const logOrder = ({
    positionState,
    data,
  }: {
    positionState: PositionState;
    data: Partial<OrderLog>;
  }) => {
    const nextEntry = {
      ...positionState.position,
      ...data,
      amount: round(amount),
      profit: round(data.profit || 0),
      index: orderLog.length,
      signal: getSignalWithoutIndicators(positionState.position.signal),
    } as OrderLog;

    orderLog.push(nextEntry);
    appendStrategyOrderLog(positionState.position.strategyName, nextEntry);
  };

  const clearPosition = (symbol: string, timestamp: number) => {
    const positionState = positionsBySymbol.get(symbol);
    if (!positionState) {
      return;
    }

    const nextPositionLog = {
      direction: positionState.position.direction,
      open: {
        timestamp: positionState.position.timestamp,
        amount: round(positionState.position.amount),
      },
      close: {
        timestamp,
        amount: round(amount),
      },
    } satisfies PositionLog;

    positionLog.push(nextPositionLog);
    appendStrategyPositionLog(
      positionState.position.strategyName,
      nextPositionLog,
    );
    positionsBySymbol.delete(symbol);
  };

  const getNetProfit = ({
    grossProfit,
    price,
    qty,
  }: {
    grossProfit: number;
    price: number;
    qty: number;
  }) => {
    const fee = price * qty * FEE_PERCENT;
    return {
      fee,
      profit: grossProfit - fee,
    };
  };

  const checkTp = async ({
    symbol,
    candle,
  }: {
    symbol: string;
    candle: Candle;
  }) => {
    const positionState = positionsBySymbol.get(symbol);
    if (!positionState || !positionState.position.qty) {
      return;
    }

    const { position } = positionState;
    const isLong = position.direction === 'LONG';
    const entryPrice = position.price;

    for (const tp of positionState.takeProfits) {
      if (!positionsBySymbol.has(symbol) || position.qty <= 0) {
        break;
      }

      const reached = isLong ? candle.high >= tp.price : candle.low <= tp.price;
      if (!reached) {
        continue;
      }

      const qty = positionState.originalQty * tp.rate;
      const grossProfit = isLong
        ? (tp.price - entryPrice) * qty
        : (entryPrice - tp.price) * qty;
      const { fee, profit } = getNetProfit({
        grossProfit,
        price: tp.price,
        qty,
      });

      amount += profit;
      positionState.currentProfit += profit;
      position.qty = parseFloat((position.qty - qty).toFixed(8));

      logOrder({
        positionState,
        data: {
          timestamp: candle.timestamp,
          qty,
          price: tp.price,
          profit,
          fee,
          type: isLong ? 'TAKE_PROFIT_LONG' : 'TAKE_PROFIT_SHORT',
        },
      });

      tp.done = true;
    }

    positionState.takeProfits = positionState.takeProfits.filter(
      ({ done }) => !done,
    );

    if (position.qty <= 0) {
      clearPosition(symbol, candle.timestamp);
    }
  };

  const checkSl = async ({
    symbol,
    candle,
  }: {
    symbol: string;
    candle: Candle;
  }) => {
    const positionState = positionsBySymbol.get(symbol);
    if (!positionState?.stopLossPrice) {
      return;
    }

    const { position, stopLossPrice } = positionState;
    const isLong = position.direction === 'LONG';
    const hitStop = isLong
      ? candle.low <= stopLossPrice
      : candle.high >= stopLossPrice;

    if (!hitStop) {
      return;
    }

    const qty = position.qty;
    const grossProfit = isLong
      ? (stopLossPrice - position.price) * qty
      : (position.price - stopLossPrice) * qty;
    const { fee, profit } = getNetProfit({
      grossProfit,
      price: stopLossPrice,
      qty,
    });

    amount += profit;
    positionState.currentProfit += profit;

    logOrder({
      positionState,
      data: {
        timestamp: candle.timestamp,
        qty,
        profit,
        price: stopLossPrice,
        fee,
        type: isLong ? 'STOP_LOSS_LONG' : 'STOP_LOSS_SHORT',
      },
    });

    clearPosition(symbol, candle.timestamp);
  };

  return {
    __tradejsReplayConnector: true,
    __tradejsTestConnector: true,

    getState: async () => state,
    setState: async (newState: object) => {
      state = {
        ...state,
        ...newState,
      };
    },

    kline: async (options) => connector.kline(options),

    getPosition: async (symbol: string) => {
      const positionState = positionsBySymbol.get(symbol);
      if (!positionState) {
        return null;
      }

      const { strategyName: _strategyName, ...position } =
        positionState.position;
      return position as Position;
    },

    getPositions: async () =>
      Array.from(positionsBySymbol.values()).map(({ position }) => {
        const { strategyName: _strategyName, ...nextPosition } = position;
        return nextPosition as Position;
      }),

    getOpenPositionPnl: async () =>
      Array.from(positionsBySymbol.values()).map(({ position }) =>
        getPositionPnlSnapshot({
          position,
          currentPrice:
            currentPriceBySymbol.get(position.symbol) ?? position.price,
        }),
      ),

    placeOrder: async (order) => {
      if (positionsBySymbol.has(order.symbol)) {
        return false;
      }

      const strategyName = getStrategyName({
        signal: order.signal,
      });
      const nextPosition: ReplayPosition = {
        ...order,
        signal: getSignalWithoutIndicators(order.signal),
        amount,
        strategyName,
      };
      const { fee, profit } = getNetProfit({
        grossProfit: 0,
        price: order.price,
        qty: order.qty,
      });

      amount += profit;
      currentPriceBySymbol.set(order.symbol, order.price);

      const positionState: PositionState = {
        position: nextPosition,
        originalQty: order.qty,
        currentProfit: profit,
        takeProfits: [],
        stopLossPrice: null,
      };
      positionsBySymbol.set(order.symbol, positionState);

      logOrder({
        positionState,
        data: {
          ...order,
          profit,
          fee,
          type: order.direction === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        },
      });

      return true;
    },

    setTakeProfits: async ({ symbol, takeProfits }) => {
      const positionState = positionsBySymbol.get(symbol);
      if (!positionState) {
        return false;
      }

      positionState.takeProfits = Array.isArray(takeProfits)
        ? takeProfits.map((tp) => ({ ...tp }))
        : [];
      return true;
    },

    setStopLoss: async ({ symbol, stopLossPrice }) => {
      const positionState = positionsBySymbol.get(symbol);
      if (!positionState) {
        return false;
      }

      positionState.stopLossPrice = stopLossPrice || null;
      positionState.position = {
        ...positionState.position,
        ...(stopLossPrice != null ? { slPrice: stopLossPrice } : {}),
      };
      return true;
    },

    closePosition: async (order) => {
      const positionState = positionsBySymbol.get(order.symbol);
      if (!positionState) {
        return false;
      }

      const { position } = positionState;
      const isLong = position.direction === 'LONG';
      const grossProfit = isLong
        ? (order.price - position.price) * position.qty
        : (position.price - order.price) * position.qty;
      const { fee, profit } = getNetProfit({
        grossProfit,
        price: order.price,
        qty: position.qty,
      });

      amount += profit;
      positionState.currentProfit += profit;
      currentPriceBySymbol.set(order.symbol, order.price);

      logOrder({
        positionState,
        data: {
          ...order,
          qty: position.qty,
          profit,
          fee,
          type: isLong ? 'CLOSE_LONG' : 'CLOSE_SHORT',
        },
      });

      clearPosition(order.symbol, order.timestamp);
      return true;
    },

    getTickers: connector.getTickers,

    advanceMarket: async ({ symbol, candle }) => {
      currentPriceBySymbol.set(symbol, candle.close);
      await checkSl({ symbol, candle });
      await checkTp({ symbol, candle });
      currentPriceBySymbol.set(symbol, candle.close);
    },

    getReplayArtifacts: () => ({
      orderLog,
      positionLog,
      orderLogByStrategy,
      positionLogByStrategy,
    }),
  };
};
