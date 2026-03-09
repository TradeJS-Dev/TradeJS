---
title: Как добавить connector новой биржи
---

В этой статье: как добавить новый connector биржи и где находятся точки интеграции.

## 1. Реализуйте Connector Creator

Создайте папку:

- `@tradejs/connectors`

Реализуйте `ConnectorCreator`, возвращающий полный контракт `Connector`:

- `kline`
- `getTickers`
- `getPosition`, `getPositions`
- `placeOrder`, `closePosition`
- `getState`, `setState`

Референсы:

- Binance connector в `@tradejs/connectors`
- Coinbase connector в `@tradejs/connectors`
- ByBit connector в `@tradejs/connectors`

## 2. Зарегистрируйте connector в одном месте

Регистрация делается в:

- `@tradejs/connectors`

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
