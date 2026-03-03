import _ from 'lodash';
import { BOT_PRELOAD_DAYS } from '@constants';
import { getStrategyCreator } from '@tradejs/core/strategy';
import { connectors, ConnectorNames } from '@tradejs/connectors';
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
  const keys = await getKeys(redisKeys.botsPrefix());
  const botKeys = keys.filter((key) => key.endsWith(':bots'));

  await delay(5000);

  logger.log('info', 'files count: %s', botKeys.length);

  for await (const key of botKeys) {
    const userName = key.split(':')[1];

    logger.log('info', 'user: %s', userName);

    const botConfig: BotConfig = await getData(redisKeys.bots(userName));

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
        const strategyCreator = await getStrategyCreator(strategyName);
        if (!strategyCreator) {
          throw new Error(`Unknown strategy: ${strategyName}`);
        }
        const connector = await (
          connectors[connectorName as ConnectorNames] as ConnectorCreator
        )({
          userName,
        });
        const [binanceConnector, coinbaseConnector] = await Promise.all([
          (connectors[ConnectorNames.Binance] as ConnectorCreator)({
            userName,
          }),
          (connectors[ConnectorNames.Coinbase] as ConnectorCreator)({
            userName,
          }),
        ]);
        const interval = '15';

        const data = await connector.kline({
          symbol,
          start: preloadStart,
          end,
          interval,
        });

        const [btcData, btcBinanceData, btcCoinbaseData] = await Promise.all([
          connector.kline({
            symbol: 'BTCUSDT',
            start: preloadStart,
            end,
            interval,
          }),
          binanceConnector.kline({
            symbol: 'BTCUSDT',
            start: preloadStart,
            end,
            interval,
          }),
          coinbaseConnector.kline({
            symbol: 'BTCUSDT',
            start: preloadStart,
            end,
            interval,
          }),
        ]);

        const candle = data.pop();
        const btcCandle = btcData.pop();

        const strategy = await strategyCreator({
          userName,
          config: strategyConfig,
          symbol,
          data,
          btcData,
          btcBinanceData,
          btcCoinbaseData,
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
