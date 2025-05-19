import 'dotenv/config';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';

const byBitConnector = ByBitConnectorCreator({
  key: '',
  secret: '',
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
    0.1,
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
