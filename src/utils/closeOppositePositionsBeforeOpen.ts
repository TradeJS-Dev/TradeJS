import _ from 'lodash';
import { Connector, Direction } from '@types';
import { logger } from '@utils/logger';

type CloseOppositePositionsBeforeOpenOptions = {
  connector: Connector;
  currentSymbol: string;
  currentDirection: Direction;
  price: number;
  timestamp: number;
  strategyName?: string;
};

export const closeOppositePositionsBeforeOpen = async ({
  connector,
  currentSymbol,
  currentDirection,
  price,
  timestamp,
  strategyName = 'Strategy',
}: CloseOppositePositionsBeforeOpenOptions) => {
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
