import _ from 'lodash';
import type {
  Connector,
  StrategyConfig,
  StrategyEntrySignalContext,
  StrategyManifest,
} from '@tradejs/types';
import { logger } from '@tradejs/infra/logger';

type CloseOppositePositionsBeforeOpenOptions = {
  connector: Connector;
  entryContext: StrategyEntrySignalContext;
};

type BeforePlaceOrderHook = NonNullable<
  NonNullable<StrategyManifest['hooks']>['beforePlaceOrder']
>;

interface CreateCloseOppositeBeforePlaceOrderHookParams {
  isEnabled: (config: StrategyConfig) => boolean;
}

export const closeOppositePositionsBeforeOpen = async ({
  connector,
  entryContext,
}: CloseOppositePositionsBeforeOpenOptions) => {
  const {
    symbol: currentSymbol,
    direction: currentDirection,
    timestamp,
    prices,
    strategy: strategyName,
  } = entryContext;
  const price = prices.currentPrice;

  try {
    logger.log(
      'info',
      '[%s] checking open positions before open: %s %s',
      strategyName,
      currentSymbol,
      currentDirection,
    );

    const positions = await connector.getPositions();
    const openPositions = (positions || []).filter(
      (item) => item && Number(item.qty) > 0,
    );

    logger.log(
      'info',
      '[%s] open positions found: %s',
      strategyName,
      openPositions.length,
    );

    const oppositePositions = openPositions.filter(
      (item) =>
        item.symbol !== currentSymbol && item.direction !== currentDirection,
    );

    if (_.isEmpty(oppositePositions)) {
      logger.log(
        'info',
        '[%s] no opposite positions to close before open: %s',
        strategyName,
        currentSymbol,
      );
      return;
    }

    for (const position of oppositePositions) {
      logger.log(
        'info',
        '[%s] closing opposite position: %s %s qty=%s',
        strategyName,
        position.symbol,
        position.direction,
        position.qty,
      );

      try {
        await connector.closePosition({
          symbol: position.symbol,
          price,
          timestamp,
          direction: position.direction,
        });

        logger.log(
          'info',
          '[%s] opposite position closed: %s',
          strategyName,
          position.symbol,
        );
      } catch (err) {
        logger.log(
          'error',
          '[%s] failed to close opposite position: %s %s',
          strategyName,
          position.symbol,
          err,
        );
      }
    }
  } catch (err) {
    logger.log(
      'error',
      '[%s] failed to load open positions before open: %s %s',
      strategyName,
      currentSymbol,
      err,
    );
  }
};

export const createCloseOppositeBeforePlaceOrderHook = ({
  isEnabled,
}: CreateCloseOppositeBeforePlaceOrderHookParams): BeforePlaceOrderHook => {
  return async ({ ctx, entry }) => {
    if (ctx.env === 'BACKTEST') {
      return;
    }

    if (!isEnabled(ctx.strategyConfig)) {
      return;
    }

    await closeOppositePositionsBeforeOpen({
      connector: ctx.connector,
      entryContext: entry.context,
    });
  };
};
