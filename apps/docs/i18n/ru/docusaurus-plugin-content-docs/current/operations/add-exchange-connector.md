---
title: Как добавить connector новой биржи
---

В этой статье: как добавить новый connector биржи и где находятся точки интеграции.

## 1. Реализуйте Connector Creator

Создайте папку:

- `packages/connectors/src/<Exchange>/index.ts`

Реализуйте `ConnectorCreator`, возвращающий полный контракт `Connector`:

- `kline`
- `getTickers`
- `getPosition`, `getPositions`
- `placeOrder`, `closePosition`
- `getState`, `setState`

Референсы:

- `packages/connectors/src/Binance/index.ts`
- `packages/connectors/src/Coinbase/index.ts`
- `packages/connectors/src/ByBit/index.ts`

## 2. Зарегистрируйте connector в одном месте

Регистрация делается в:

- `packages/connectors/src/index.ts`

Обновите:

- `ConnectorNames`
- `ConnectorProviders`
- `providerToConnectorName`
- `connectors`

После этого резолвинг connector в `backtest` и выбор `continuity --provider` используют общий map провайдеров.

## 3. Обновления типов

Если провайдер должен быть user-facing в фильтрах/конфигах, обновите union в:

- `packages/core/src/types/trade.ts` (`Provider`)

## 4. Точки интеграции в CLI

Уже переведены на map провайдеров:

- `packages/cli/src/scripts/backtest.ts`
- `packages/cli/src/scripts/continuity.ts`

Остаются архитектурно фиксированные места:

- в `backtest.ts` и `signals.ts` дополнительно грузятся BTC reference данные из Binance/Coinbase для spread/correlation веток
- `results.ts --coverage` использует вселенную тикеров ByBit для denominator

Поэтому добавить connector для обычной market-history интеграции просто, но часть потоков по дизайну пока привязана к Binance/Coinbase/ByBit.

## 5. Рекомендуемый checklist проверки

1. `yarn dev-tsc`
2. `yarn unit`
3. `yarn update-history -- --connector <provider> --config <Strategy:Config> --timeframe 15`
4. `yarn continuity --provider <provider> --timeframe 15 --tickers BTCUSDT`
5. `yarn backtest --connector <provider> --config <Strategy:Config> --tests 20`

## 6. Опциональный следующий шаг

Если хотите еще меньше точек входа при добавлении connector, вынесите BTC reference providers и coverage universe в настраиваемые provider settings вместо фиксированных Binance/Coinbase/ByBit.
