import { getUnixTime } from 'date-fns';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import botConfig from '@/bot.config';

export const runBot = async () => {
  const byBitConnector = ByBitConnectorCreator({
    key: '',
    secret: '',
  });

  for await (const bot of botConfig) {
    const timestamp = getUnixTime(new Date()) * 1000;

    const { symbol, strategy: strategyCreator, strategyConfig } = bot;

    const strategy = strategyCreator(strategyConfig);

    await strategy(symbol, timestamp, byBitConnector);
  }

  return true;
};
