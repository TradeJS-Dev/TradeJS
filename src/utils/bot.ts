import { getUnixTime } from 'date-fns';
import { strategies, StrategyNames } from '@src/strategy';
import { connectors, ConnectorNames } from '@src/connectors';
import botConfig from '@/bot.config';
import { logger } from '@utils/logger';
import { stringify } from '@utils/stringify';
import { getTimestamp } from '@utils/timestamp';
import { ConnectorCreator } from '@types';

export const runBot = async () => {
  const botResults = [];
  const preloadStart = getTimestamp(30);
  const end = getUnixTime(new Date()) * 1000;

  for await (const bot of botConfig) {
    const { symbol, strategyName, strategyConfig, connectorName } = bot;

    const strategyCreator = strategies[strategyName as StrategyNames];
    const connector = (
      connectors[connectorName as ConnectorNames] as ConnectorCreator
    )({
      key: '',
      secret: '',
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

  logger.log('info', 'botResults: %s', stringify(botResults));

  return botResults;
};
