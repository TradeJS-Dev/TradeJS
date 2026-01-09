import _ from 'lodash';
import { BOT_PRELOAD_DAYS } from '@constants';
import { strategies, StrategyNames } from '@src/strategy';
import { connectors, ConnectorNames } from '@src/connectors';
import { logger } from '@utils/logger';
import { getData, redisKeys, getKeys } from '@utils/redis';
import { toJson } from '@utils/toJson';
import { getTimestamp } from '@utils/timestamp';
import { delay } from '@utils/async';
import { ConnectorCreator, BotConfig } from '@types';

export const runBot = async () => {
  const botResults = [];
  const preloadStart = getTimestamp(BOT_PRELOAD_DAYS);
  const end = getTimestamp();
  const keys = await getKeys(redisKeys.bots());

  await delay(5000);

  logger.log('info', 'files count: %s', keys.length);

  for await (const key of keys) {
    const userName = key.split(':')[1];

    logger.log('info', 'user: %s', userName);

    const botConfig: BotConfig = await getData(redisKeys.bot(userName));

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

        const btcData = await connector.kline({
          symbol: 'BTCUSDT',
          start: preloadStart,
          end,
          interval: '15',
        });

        data.pop();
        btcData.pop();

        const candle = data.pop();
        const btcCandle = btcData.pop();

        const strategy = strategyCreator({
          config: strategyConfig,
          symbol,
          data,
          btcData,
          connector,
        });

        logger.log('info', 'strategy created');

        if (!candle || !btcCandle) {
          throw new Error('Candle is empty');
        }

        const status = await strategy(candle, btcCandle);

        botResults.push({
          symbol,
          status: JSON.stringify(status),
        });
      } catch (err) {
        logger.log('error', 'bot %s error: %s', bot.symbol, toJson(err, false));
      }
    }
  }

  logger.log('info', 'botResults: %s', toJson(botResults, true));

  return botResults;
};
