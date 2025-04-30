import 'dotenv/config';
import fs from 'fs';
import { RestClientV5 } from 'bybit-api';
import { getUnixTime, addDays } from 'date-fns';

const API_KEY = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_API_SECRET;
const useTestnet = false;

const client = new RestClientV5({
  key: API_KEY,
  secret: API_SECRET,
  testnet: useTestnet,
});

const SYMBOL = 'SUIUSDT';

const placeOrder = async () => {
  const TPL = [
    {
      rate: 0.3,
      profit: 0.07,
    },
    {
      rate: 0.4,
      profit: 0.11,
    },
  ];

  const LIMIT = 200;
  const PRICE = 1.67;

  const QTY = LIMIT / PRICE;

  console.log(QTY);

  const resMain = await client.submitOrder({
    category: 'linear',
    symbol: SYMBOL,
    side: 'Buy',
    orderType: 'Market',
    qty: QTY.toFixed(0),
    orderFilter: 'Order',
  });

  console.log(resMain);

  if (!resMain.result?.orderId) {
    return;
  }

  for await (const tpl of TPL) {
    const qty = QTY * tpl.rate;
    const summ = qty * PRICE;

    const res = await client.setTradingStop({
      category: 'linear',
      symbol: SYMBOL,
      tpSize: qty.toFixed(0),
      tpslMode: 'Partial',
      takeProfit: `${PRICE * (1 + tpl.profit)}`,
      tpOrderType: 'Market',
      positionIdx: 0,
      // orderFilter: 'tpslOrder',
    });

    console.log(JSON.stringify(res, null, 2));
  }
};

const getOrders = async () => {
  // const info = await client.getPositionInfo({
  //   category: 'linear',
  // });

  const orders = await client.getActiveOrders({
    symbol: SYMBOL,
    category: 'linear',
    orderFilter: 'Order',
  });

  console.log('orders', JSON.stringify(orders, null, 2));

  return orders.result.list;
};

const cancelOrder = async () => {
  const cancelRes = await client.cancelAllOrders({
    symbol: SYMBOL,
    category: 'linear',
  });

  console.log('cancelRes', JSON.stringify(cancelRes, null, 2));
};

const getPosition = async () => {
  const position = await client.getPositionInfo({
    symbol: SYMBOL,
    category: 'linear',
  });

  console.log('position', JSON.stringify(position, null, 2));
};

const closePosition = async () => {
  const closeRes = await client.submitOrder({
    category: 'linear',
    symbol: SYMBOL,
    side: 'Sell',
    orderType: 'Market',
    qty: '0',
    reduceOnly: true,
  });

  console.log(closeRes);
};

// cancelOrder();
// getOrders();
// placeOrder();
getPosition();
// closePosition();
