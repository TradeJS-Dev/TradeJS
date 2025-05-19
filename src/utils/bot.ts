import { getUnixTime } from 'date-fns';
import botConfig from '@/bot.config';
import { logger } from '@utils/logger';
import { stringify } from '@utils/stringify';

export const runBot = async () => {
  const botResults = [];

  for await (const bot of botConfig) {
    const timestamp = getUnixTime(new Date()) * 1000;

    const {
      symbol,
      strategy: strategyCreator,
      strategyConfig,
      connector,
    } = bot;

    const strategy = strategyCreator(strategyConfig);

    const status = await strategy(symbol, timestamp, connector);

    botResults.push({
      symbol,
      status,
    });
  }

  logger.log('info', 'botResults: %s', stringify(botResults));

  return botResults;
};
