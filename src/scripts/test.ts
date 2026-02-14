import 'dotenv/config';
import { connectors } from '@src/connectors';
import { Connector } from '@types';

const SYMBOL = 'TACUSDT';

const placeOrder = async (connector: Connector) => {
  const price = 0.0041;

  const res = await connector.placeOrder(
    {
      symbol: SYMBOL,
      qty: 100 / price,
      price,
      timestamp: 0,
      direction: 'LONG',
      isLimit: true,
    },
    [{ price: 0.0047, rate: 1 }],
    0.004,
  );

  console.log('res', res);
};

const getPosition = async (connector: Connector) => {
  const res = await connector.getPosition(SYMBOL);

  console.log('res', res);
};

const getPositions = async (connector: Connector) => {
  const res = await connector.getPositions();

  console.log('res', res);
};

const closeOrder = async (connector: Connector) => {
  const res = await connector.closePosition({
    symbol: SYMBOL,
    price: 3.379,
    timestamp: 0,
    direction: 'SHORT',
  });

  console.log('res', res);
};

const main = async () => {
  const byBitConnector = await connectors.ByBit({
    userName: 'root',
  });

  // await placeOrder(byBitConnector);
  // await closeOrder(byBitConnector);
  await getPositions(byBitConnector);
};

main();
