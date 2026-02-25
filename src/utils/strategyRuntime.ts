import { logger } from '@utils/logger';
import {
  enrichSignalWithMlAi,
  executeEntryOrder,
  resolveStrategyConfig,
} from '@utils/strategyHelpers';
import {
  CreateStrategyCoreParams,
  StrategyCoreRunner,
  StrategyConfig,
  StrategyCreator,
  StrategyDecision,
} from '@types';

interface CreateStrategyRuntimeParams<TConfig extends StrategyConfig> {
  strategyName: string;
  defaults: TConfig;
  createCore: (
    params: CreateStrategyCoreParams<TConfig>,
  ) => Promise<StrategyCoreRunner> | StrategyCoreRunner;
}

export const createStrategyRuntime = <TConfig extends StrategyConfig>({
  strategyName,
  defaults,
  createCore,
}: CreateStrategyRuntimeParams<TConfig>): StrategyCreator => {
  return async ({
    userName,
    config: baseConfig,
    symbol,
    data,
    btcData,
    connector,
  }) => {
    const { config, configFromBacktest } = await resolveStrategyConfig({
      strategyName,
      userName,
      symbol,
      baseConfig,
      defaults,
    });

    const core = await createCore({
      userName,
      symbol,
      config,
      configFromBacktest,
      connector,
      data,
      btcData,
    });

    return async (candle, btcCandle) => {
      data.push(candle);
      btcData.push(btcCandle);

      const decision = await core(candle, btcCandle);

      if (decision.kind === 'skip') {
        return decision.code;
      }

      const makeOrdersEnabled =
        typeof config.MAKE_ORDERS === 'boolean' ? config.MAKE_ORDERS : true;

      if (decision.kind === 'exit') {
        if (!makeOrdersEnabled) {
          return decision.code;
        }

        try {
          await connector.closePosition({
            symbol,
            price: decision.closePlan.price,
            timestamp: decision.closePlan.timestamp,
            direction: decision.closePlan.direction,
          });
        } catch (err) {
          logger.error('close order error: %s %s', symbol, err);
          return 'ORDER_ERROR';
        }

        return decision.code;
      }

      const env = String(config.ENV ?? 'BACKTEST');
      const signal = decision.signal;

      let quality: number | undefined;
      if (signal) {
        quality = await enrichSignalWithMlAi({
          signal,
          symbol,
          direction: signal.direction,
          env,
          ml: decision.runtime?.ml,
          ai: decision.runtime?.ai,
        });
        signal.orderStatus = 'canceled';
      }

      const minAiQuality = decision.runtime?.ai?.minQuality ?? 4;
      const shouldMakeOrder =
        makeOrdersEnabled &&
        (!signal ||
          env === 'BACKTEST' ||
          (quality != null && quality >= minAiQuality));

      if (!shouldMakeOrder) {
        return signal ?? decision.code;
      }

      try {
        if (signal) {
          await executeEntryOrder({
            connector,
            symbol,
            direction: decision.entryContext.direction,
            qty: decision.orderPlan.qty,
            currentPrice: decision.entryContext.prices.currentPrice,
            timestamp: decision.entryContext.timestamp,
            takeProfits: decision.orderPlan.takeProfits ?? [],
            stopLossPrice: decision.entryContext.prices.stopLossPrice ?? null,
            signal,
            beforePlaceOrder: decision.runtime?.beforePlaceOrder,
          });
          return signal;
        }

        await decision.runtime?.beforePlaceOrder?.();
        await connector.placeOrder(
          {
            symbol,
            qty: decision.orderPlan.qty,
            price: decision.entryContext.prices.currentPrice,
            timestamp: decision.entryContext.timestamp,
            direction: decision.entryContext.direction,
          },
          decision.orderPlan.takeProfits,
          decision.entryContext.prices.stopLossPrice ?? null,
        );
      } catch (err) {
        if (signal) {
          signal.orderStatus = 'failed';
        }
        logger.error('order error: %s %s', symbol, err);
        return signal ?? 'ORDER_ERROR';
      }

      return signal ?? decision.code;
    };
  };
};
