import _ from 'lodash';
import { BOT_PRELOAS_DAYS } from '@constants';
import { strategies, StrategyNames } from '@src/strategy';
import { connectors, ConnectorNames } from '@src/connectors';
import { logger } from '@utils/logger';
import { getFiles, getData } from '@utils/data';
import { toJson } from '@/src/utils/toJson';
import { getTimestamp } from '@utils/timestamp';
import { ConnectorCreator, BotConfig } from '@types';

export const runBot = async () => {
  const botResults = [];
  const preloadStart = getTimestamp(BOT_PRELOAS_DAYS);
  const end = getTimestamp();
  const files = await getFiles('data/bots');

  logger.log('info', 'files count: %s', files.length);

  for await (const file of files) {
    const userName = file.replace('.json', '');

    logger.log('info', 'user: %s', userName);

    const botConfig: BotConfig = await getData('data/bots', userName, {
      useCache: false,
    });

    if (_.isEmpty(botConfig)) {
      logger.log('error', 'botConfig is empty: %s', userName);

      continue;
    }

    logger.log('info', 'bots count: %s', botConfig.length);

    for await (const bot of botConfig) {
      const { symbol, strategyName, strategyConfig, connectorName, disabled } =
        bot;

      logger.log('info', 'bot %s', symbol);

      if (disabled) {
        logger.log('error', 'bot %s disabled', symbol);

        continue;
      }

      try {
        const strategyCreator = strategies[strategyName as StrategyNames];
        const connector = (
          connectors[connectorName as ConnectorNames] as ConnectorCreator
        )({
          userName,
        });

        const data = await connector.kline({
          symbol,
          start: preloadStart,
          end,
          interval: '15',
        });

        const candle = data.pop();

        const strategy = strategyCreator(strategyConfig, data);

        logger.log('info', 'strategy created');

        const status = await strategy(symbol, candle!, connector);

        botResults.push({
          symbol,
          status,
        });
      } catch (err) {
        logger.log('error', 'bot %s error: %s', bot.symbol, toJson(err, false));
      }
    }
  }

  logger.log('info', 'botResults: %s', toJson(botResults, true));

  return botResults;
};
