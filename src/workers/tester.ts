import { testing } from '@utils/testing';
import { strategies, StrategyNames } from '@src/strategy';
import { connectors, ConnectorNames } from '@src/connectors';
import { TestConfig, ConnectorCreator } from '@types';
import { setData, getData } from '@utils/data';
import { uuid } from '@utils/uuid';

process.on('message', async ({ chunkId }: { chunkId: string }) => {
  const tests = (await getData('data/cache', chunkId, {
    useCache: false,
  })) as TestConfig;

  for await (const test of tests) {
    try {
      const {
        name,
        symbol,
        options,
        strategyName,
        strategyConfig,
        connectorName,
      } = test;

      const strategyCreator = strategies[strategyName as StrategyNames];
      const connector = (
        connectors[connectorName as ConnectorNames] as ConnectorCreator
      )({
        key: '',
        secret: '',
      });

      const { orderLog, stat } = await testing({
        name,
        symbol,
        options,
        strategyCreator,
        strategyConfig,
        connector,
      });

      const orderLogId = uuid();

      await setData('data/cache', orderLogId, orderLog, { useCache: false });

      process.send?.({
        stat,
        orderLogId,
        test,
      });
    } catch (error) {
      process.send?.({ error, id: test.name });
    }
  }

  process.send?.({ done: true });
});
