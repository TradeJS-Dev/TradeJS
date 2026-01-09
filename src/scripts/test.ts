import 'dotenv/config';
import { connectors } from '@src/connectors';

const byBitConnector = connectors.ByBit({
  userName: 'root',
});

const SYMBOL = 'TACUSDT';

const placeOrder = async () => {
  const price = 0.0041;

  const res = await byBitConnector.placeOrder(
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

const getPosition = async () => {
  const res = await byBitConnector.getPosition(SYMBOL);

  console.log('res', res);
};

const closeOrder = async () => {
  const res = await byBitConnector.closePosition({
    symbol: SYMBOL,
    price: 3.379,
    timestamp: 0,
    direction: 'SHORT',
  });

  console.log('res', res);
};

placeOrder();
// closeOrder();
// getPosition();
