import { getUnixTime } from 'date-fns';
import botConfig from '@/bot.config';

export const runBot = async () => {
  for await (const bot of botConfig) {
    const timestamp = getUnixTime(new Date()) * 1000;

    const {
      symbol,
      strategy: strategyCreator,
      strategyConfig,
      connector,
    } = bot;

    const strategy = strategyCreator(strategyConfig);

    await strategy(symbol, timestamp, connector);
  }

  return true;
};
