import 'dotenv/config';
import { connectors } from '@src/connectors';

const byBitConnector = connectors.ByBit({
  userName: 'root',
});

const SYMBOL = 'SUIUSDT';

const placeOrder = async () => {
  const res = await byBitConnector.placeOrder(
    {
      symbol: SYMBOL,
      qty: 30,
      price: 3.79,
      timestamp: 0,
      direction: 'SHORT',
    },
    [
      { profit: 0.1, rate: 0.5 },
      { profit: 0.2, rate: 0.5 },
    ],
    3.8,
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
