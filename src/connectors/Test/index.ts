'use server';

import _ from 'lodash';
import { evaluate } from 'mathjs';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { getUnixTime } from 'date-fns';
import { setCache } from '@src/utils/cache';
import {
  TestConnectorCreator as TCC,
  Kline,
  OrderWithDirection,
  OrderLogData,
  KlineChartData,
  Sl,
  Tp,
} from '@types';

export const TestConnectorCreator: TCC = (config) => {
  let CURRENT_POSITION: OrderWithDirection | null = null; // Текущая открытая позиция
  let ORIGINAL_QTY = 0; // Исходный объём позиции
  let AMOUNT = 100; // Текущий капитал в $
  let MIN_AMOUNT = AMOUNT; // Минимальный капитал за всё время
  let ORDERS = 0; // Количество совершённых сделок
  let TP: Tp[] = []; // Активные тейк-профиты
  let SL: Sl | null = null; // Активные стоп-лоссы
  const ORDER_LOG: OrderLogData = []; // Лог всех ордеров
  let LOADED_DATA: KlineChartData = []; // Предзагруженные данные свечей

  const byBitConnector = ByBitConnectorCreator(config);

  const loadData: Kline = async (options) => {
    const end = getUnixTime(new Date()) * 1000;
    const data = await byBitConnector.kline({
      symbol: options.symbol,
      interval: options.interval,
      end,
    });

    LOADED_DATA = data;
    return LOADED_DATA;
  };

  const kline: Kline = async (options) => {
    if (_.isEmpty(LOADED_DATA)) {
      await loadData(options);
    }
    return LOADED_DATA.filter((item) => item.timestamp <= options.end);
  };

  return {
    kline,

    getStat: () => ({
      amount: AMOUNT,
      minAmount: MIN_AMOUNT,
      orders: ORDERS,
    }),

    saveStat: (symbol: string, id: string) => {
      setCache('data', `_backtest_${symbol}_${id}`, ORDER_LOG);
    },

    getPosition: async () => CURRENT_POSITION || null,

    checkTp: async (symbol: string, start: number, end: number) => {
      const data = await kline({ symbol, interval: '5', start, end });

      if (_.isEmpty(data) || !CURRENT_POSITION || !CURRENT_POSITION?.qty) {
        return;
      }

      const isLong = CURRENT_POSITION.direction === 'LONG';
      const entryPrice = CURRENT_POSITION.price;

      for (const candle of data) {
        const high = candle.high;
        const low = candle.low;

        TP.forEach((tp) => {
          if (!CURRENT_POSITION) {
            return;
          }

          const targetPrice = isLong
            ? evaluate(`${entryPrice} * (1 + ${tp.profit})`)
            : evaluate(`${entryPrice} * (1 - ${tp.profit})`);

          const reached = isLong
            ? evaluate(`${high} >= ${targetPrice}`)
            : evaluate(`${low} <= ${targetPrice}`);

          if (reached) {
            const qty = evaluate(`${ORIGINAL_QTY} * ${tp.rate}`);
            const profit = isLong
              ? evaluate(`(${targetPrice} - ${entryPrice}) * ${qty}`)
              : evaluate(`(${entryPrice} - ${targetPrice}) * ${qty}`);

            AMOUNT = evaluate(`${AMOUNT} + ${profit}`);
            CURRENT_POSITION.qty = evaluate(`${CURRENT_POSITION.qty} - ${qty}`);

            ORDER_LOG.push({
              ...CURRENT_POSITION,
              timestamp: candle.timestamp,
              qty,
              price: targetPrice,
              profit,
              type: isLong ? 'TAKE_PROFIT_LONG' : 'TAKE_PROFIT_SHORT',
            });

            tp.done = true;
          }
        });

        TP = TP.filter(({ done }) => !done);

        if (CURRENT_POSITION.qty == 0) {
          break;
        }
      }
    },

    checkSl: async (symbol: string, start: number, end: number) => {
      if (!SL || SL.done || !CURRENT_POSITION) {
        return;
      }

      const data = await kline({ symbol, interval: '5', start, end });
      if (_.isEmpty(data)) {
        return;
      }

      const isLong = CURRENT_POSITION.direction === 'LONG';

      for (const candle of data) {
        const high = candle.high;
        const low = candle.low;

        const hitStop = isLong ? low <= SL.price : high >= SL.price;

        if (hitStop) {
          const qty = CURRENT_POSITION.qty;
          const profit = isLong
            ? evaluate(`(${SL.price} - ${CURRENT_POSITION.price}) * ${qty}`)
            : evaluate(`(${CURRENT_POSITION.price} - ${SL.price}) * ${qty}`);

          AMOUNT = evaluate(`${AMOUNT} + ${profit}`);
          CURRENT_POSITION.qty = 0;

          ORDER_LOG.push({
            ...CURRENT_POSITION,
            timestamp: candle.timestamp,
            qty,
            profit,
            price: SL.price,
            type: isLong ? 'STOP_LOSS_LONG' : 'STOP_LOSS_SHORT',
          });

          TP = [];
          SL = null;
          ORIGINAL_QTY = 0;
          CURRENT_POSITION = null;
    
          break;
        }
      }
    },

    placeOrder: async (order, tp = [], sl) => {
      TP = tp;
      SL = sl || null;
      CURRENT_POSITION = { ...order };
      ORIGINAL_QTY = order.qty;

      ORDER_LOG.push({
        ...order,
        profit: 0,
        type: order.direction === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
      });

      ORDERS++;
      return true;
    },

    closePosition: async (order) => {
      if (!CURRENT_POSITION) {
        return false;
      }

      const isLong = CURRENT_POSITION.direction === 'LONG';
      const profit = isLong
        ? evaluate(
            `(${order.price} - ${CURRENT_POSITION.price}) * ${CURRENT_POSITION.qty}`,
          )
        : evaluate(
            `(${CURRENT_POSITION.price} - ${order.price}) * ${CURRENT_POSITION.qty}`,
          );

      AMOUNT = evaluate(`${AMOUNT} + ${profit}`);
      MIN_AMOUNT = _.min([MIN_AMOUNT, AMOUNT]) || MIN_AMOUNT;

      ORDER_LOG.push({
        ...CURRENT_POSITION,
        ...order,
        profit,
        type: isLong ? 'CLOSE_LONG' : 'CLOSE_SHORT',
      });

      TP = [];
      SL = null;
      ORIGINAL_QTY = 0;
      CURRENT_POSITION = null;

      return true;
    },

    getTickers: async () => [],
  };
};
