---
title: Как добавить connector новой биржи
---

В этой статье: как добавить новый connector биржи и где находятся точки интеграции.

Важно:

- коннекторы не подключаются через `tradejs.config.ts`
- `tradejs.config.ts` используется только для strategy/indicator plugins
- чтобы новый провайдер работал в CLI, коннектор должен быть добавлен в карту коннекторов, с которой собран ваш `@tradejs/cli`

## 1. Реализуйте Connector Creator

Реализуйте коннектор в своем модуле/пакете (например, `@your-scope/tradejs-connectors`) и верните полный типизированный контракт `Connector`.

Минимальный typed-скелет:

```ts
import type {
  Connector,
  ConnectorCreator,
  KlineRequest,
  KlineChartData,
  Ticker,
  Position,
  Order,
  Tp,
  Sl,
} from '@tradejs/core/types';

const kline = async (options: KlineRequest): Promise<KlineChartData> => {
  return [];
};

const getTickers = async (): Promise<Ticker[]> => {
  return [];
};

const getPosition = async (symbol: string): Promise<Position | null> => {
  return null;
};

const getPositions = async (): Promise<Position[]> => {
  return [];
};

const placeOrder = async (
  order: Order,
  tp?: Tp[],
  slPrice?: Sl,
): Promise<boolean> => {
  return true;
};

const closePosition = async (order: Omit<Order, 'qty'>): Promise<boolean> => {
  return true;
};

export const MyExchangeConnectorCreator: ConnectorCreator = async ({
  userName,
}) => {
  const connector: Connector = {
    kline,
    getTickers,
    getPosition,
    getPositions,
    placeOrder,
    closePosition,
    getState: async () => ({}),
    setState: async (_state: object) => {},
  };

  return connector;
};
```

Обязательные методы `Connector`:

- `kline`
- `getTickers`
- `getPosition`, `getPositions`
- `placeOrder`, `closePosition`
- `getState`, `setState`

## 2. Зарегистрируйте connector в одном месте

Зарегистрируйте провайдер в карте коннекторов, которую использует ваш CLI build (обычно `@tradejs/connectors`).

Обновите:

- `ConnectorNames`
- `ConnectorProviders`
- `providerToConnectorName`
- `connectors`

После этого резолвинг connector в `backtest` и выбор `continuity --provider` используют общий map провайдеров.

## 3. Обновления типов

Если провайдер должен быть user-facing в фильтрах/конфигах, обновите union в:

- `@tradejs/core` (`Provider`)

## 4. Точки интеграции в CLI

Уже переведены на map провайдеров:

- команда `backtest` в `@tradejs/cli`
- команда `continuity` в `@tradejs/cli`

Остаются архитектурно фиксированные места:

- в `backtest.ts` и `signals.ts` дополнительно грузятся BTC reference данные из Binance/Coinbase для spread/correlation веток
- `results.ts --coverage` использует вселенную тикеров ByBit для denominator

Поэтому добавить connector для обычной market-history интеграции просто, но часть потоков по дизайну пока привязана к Binance/Coinbase/ByBit.

## 5. Рекомендуемый checklist проверки

1. Прогоните TypeScript-проверки в вашем проекте connector.
2. Прогоните unit-тесты в вашем проекте connector.
3. `npx @tradejs/cli backtest --updateOnly --connector <provider> --config <Strategy:Config> --timeframe 15`
4. `npx @tradejs/cli continuity --provider <provider> --timeframe 15 --tickers BTCUSDT`
5. `npx @tradejs/cli backtest --connector <provider> --config <Strategy:Config> --tests 20`

## 6. Опциональный следующий шаг

Если хотите еще меньше точек входа при добавлении connector, вынесите BTC reference providers и coverage universe в настраиваемые provider settings вместо фиксированных Binance/Coinbase/ByBit.
