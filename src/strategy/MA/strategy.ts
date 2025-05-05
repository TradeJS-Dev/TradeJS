import _ from 'lodash';
import { SMA } from 'technicalindicators';
import { config as DEFAULT_CONFIG } from './config';
import { Strategy, StrategyCreator, StrategyConfig } from '@types';

export const MaStrategyCreator: StrategyCreator = (baseConfig) => {
  const config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
  } as StrategyConfig & typeof DEFAULT_CONFIG;

  const strategy: Strategy = async (symbol, timestamp, connector) => {
    let data = await connector.kline({
      symbol,
      interval: '5',
      end: timestamp,
    });

    if (_.isEmpty(data)) {
      return;
    }

    const price = data[data.length - 1].close;

    if (!price) {
      return;
    }

    const position = await connector.getPosition(symbol);
    const positionExists = !_.isEmpty(position);

    const closesPrices = data.map((item) => item.close);

    const Line1 = SMA.calculate({
      period: config.PERIODS[0],
      values: closesPrices,
    }).pop();

    const Line2 = SMA.calculate({
      period: config.PERIODS[1],
      values: closesPrices,
    }).pop();

    if (!Line1 || !Line2) {
      return;
    }

    if (!positionExists && Line1 > Line2) {
      const qty = config.LIMIT / price;

      await connector.placeOrder(
        {
          symbol,
          qty,
          price,
          timestamp,
        },
        config.TP,
      );
    }

    if (positionExists && Line1 < Line2) {
      await connector.closePosition({
        symbol,
        price,
        timestamp,
      });
    }
  };

  return strategy;
};
