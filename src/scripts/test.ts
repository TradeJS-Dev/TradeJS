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

type Coin = {
  symbol: string;
  lastPrice: string;
  prevPrice24h: string;
  price24hPcnt: string;
  prevPrice1h: string;
  volume24h: string;
};

type ResultItem = {
  label: string;
  value: string;
  category: 'volatility24h' | 'volatility1h' | 'volume';
};

export const getTopCoins = (data: Coin[]): { label: string; value: string }[] => {
  const result: ResultItem[] = [];
  const selected = new Set<string>();

  const getBaseSymbol = (symbol: string) =>
    symbol.replace(/(USDT|USD|PERP)$/i, '');

  const byVol24h = [...data]
    .map(coin => ({
      ...coin,
      volatility24h: Math.abs(parseFloat(coin.price24hPcnt)),
    }))
    .sort((a, b) => b.volatility24h - a.volatility24h);

  const byVol1h = [...data]
    .map(coin => {
      const prev1h = parseFloat(coin.prevPrice1h);
      const last = parseFloat(coin.lastPrice);
      const volatility1h = prev1h ? Math.abs((last - prev1h) / prev1h) : 0;
      return {
        ...coin,
        volatility1h,
      };
    })
    .sort((a, b) => b.volatility1h - a.volatility1h);

  const byVolume = [...data]
    .map(coin => ({
      ...coin,
      volume24hNum: parseFloat(coin.volume24h),
    }))
    .sort((a, b) => b.volume24hNum - a.volume24hNum);

  const addTop = (
    list: Coin[],
    category: ResultItem['category'],
    limit: number
  ) => {
    for (const coin of list) {
      if (!selected.has(coin.symbol)) {
        selected.add(coin.symbol);
        result.push({
          label: `${getBaseSymbol(coin.symbol)} (${category})`,
          value: coin.symbol,
          category,
        });
        if (result.length >= limit) break;
      }
    }
  };

  addTop(byVol24h, 'volatility24h', 10);
  addTop(byVol1h, 'volatility1h', 20);
  addTop(byVolume, 'volume', 30);

  return result
    .slice(0, 30)
    .sort((a, b) =>
      a.category === b.category
        ? a.value.localeCompare(b.value)
        : a.category.localeCompare(b.category)
    )
    .map(({ label, value }) => ({ label, value }));
};

const getTickers = async () => {
  const data = await client
    .getTickers({
        category: 'linear',
    });

  console.log(getTopCoins(data.result.list));
}

// cancelOrder();
// getOrders();
// placeOrder();
// getPosition();
// closePosition();
getTickers();
