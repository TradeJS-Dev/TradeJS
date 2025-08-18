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
  const bots = await getFiles('data/bots');

  logger.log('info', 'runBots: %s', bots.length);

  for await (const userName of bots) {
    const botConfig = (await getData('data/bots', userName)) as BotConfig;

    for await (const bot of botConfig) {
      const { symbol, strategyName, strategyConfig, connectorName, disabled } =
        bot;

      if (disabled) {
        continue;
      }

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

      const status = await strategy(symbol, candle!, connector);

      botResults.push({
        symbol,
        status,
      });
    }
  }

  logger.log('info', 'botResults: %s', toJson(botResults, true));

  return botResults;
};
