import _ from 'lodash';
import {
  getConnectorCreatorByName,
  BUILTIN_CONNECTOR_NAMES,
} from '@tradejs/node/connectors';
import { toJson } from '@tradejs/core/data';
import { getStrategyCreator } from '@tradejs/node/strategies';
import { delay } from '@tradejs/core/async';
import { BOT_PRELOAD_DAYS } from '@tradejs/core/constants';
import { getTimestamp } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import { getData, redisKeys, getKeys } from '@tradejs/infra/redis';
import { ConnectorCreator, BotConfig } from '@tradejs/types';

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

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
        const strategyCreator = await getStrategyCreator(
          strategyName,
          projectRoot,
        );
        if (!strategyCreator) {
          throw new Error(`Unknown strategy: ${strategyName}`);
        }
        const connectorCreator = await getConnectorCreatorByName(
          connectorName,
          projectRoot,
        );
        if (!connectorCreator) {
          throw new Error(`Unknown connector: ${connectorName}`);
        }

        const connector = await (connectorCreator as ConnectorCreator)({
          userName,
        });
        const binanceConnectorCreator = await getConnectorCreatorByName(
          BUILTIN_CONNECTOR_NAMES.Binance,
          projectRoot,
        );
        const coinbaseConnectorCreator = await getConnectorCreatorByName(
          BUILTIN_CONNECTOR_NAMES.Coinbase,
          projectRoot,
        );
        if (!binanceConnectorCreator || !coinbaseConnectorCreator) {
          throw new Error('Binance/Coinbase connectors are required');
        }
        const [binanceConnector, coinbaseConnector] = await Promise.all([
          (binanceConnectorCreator as ConnectorCreator)({
            userName,
          }),
          (coinbaseConnectorCreator as ConnectorCreator)({
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
          connectorName,
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
