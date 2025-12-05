import 'dotenv/config';
import { connectors } from '@src/connectors';

const byBitConnector = connectors.ByBit({
  userName: 'root',
});

const SYMBOL = 'AIOUSDT';

const placeOrder = async () => {
  const res = await byBitConnector.placeOrder(
    {
      symbol: SYMBOL,
      qty: 1092.4186148131964,
      price: 0.09166,
      timestamp: 0,
      direction: 'LONG',
    },
    [
      { price: 0.0979478, rate: 1 },
    ],
    0.08972483230293661,
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

// placeOrder();
// closeOrder();
getPosition();
