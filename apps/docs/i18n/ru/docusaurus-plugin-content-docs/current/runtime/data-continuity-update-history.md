---
title: 'Прокачка данных: continuity и update-history'
---

В этой статье: как обновлять исторические данные через `yarn continuity` и `yarn update-history`, и как выбирать конкретную биржу.

## 1. `yarn update-history`

`yarn update-history` — это алиас команды:

```bash
yarn backtest --updateOnly
```

Источники:

- `package.json` (script `update-history`)
- `packages/cli/src/scripts/backtest.ts`

Что делает команда:

- читает backtest config из Redis
- берет список тикеров через выбранный connector
- обновляет свечи в БД без запуска тестов

### Выбор биржи для update

Используйте `--connector` (`bybit|binance|coinbase`):

```bash
yarn update-history -- --user root --config TrendLine:base --connector bybit --timeframe 15
yarn update-history -- --user root --config TrendLine:base --connector binance --timeframe 15
yarn update-history -- --user root --config TrendLine:base --connector coinbase --timeframe 15
```

Совет: добавьте `--tickers BTCUSDT,ETHUSDT`, чтобы ограничить набор символов.

## 2. `yarn continuity`

`yarn continuity` проверяет целостность истории и может автоматически чинить разрывы.

Источник:

- `packages/cli/src/scripts/continuity.ts`

Поведение:

- загружает свечи для выбранных провайдеров
- проверяет разрывы по ожидаемому шагу интервала
- при gap: удаляет свечи symbol+interval и загружает диапазон заново

### Выбор биржи для continuity

Теперь есть фильтр провайдеров:

- `--provider all` (по умолчанию)
- `--provider bybit`
- `--provider binance`
- `--provider coinbase`
- список через запятую, например `--provider bybit,binance`

Примеры:

```bash
yarn continuity --user root --timeframe 15 --provider all
yarn continuity --user root --timeframe 15 --provider bybit
yarn continuity --user root --timeframe 15 --provider binance --tickers BTCUSDT,ETHUSDT
```

## 3. Когда какую команду использовать

- `update-history` — для регулярного обновления истории.
- `continuity` — когда подозреваете пропуски/битые диапазоны и нужно восстановление.

## 4. Операционные замечания

- `continuity` может быть тяжелой и деструктивной для затронутого symbol+interval (удаляет и перезаливает).
- Явно задавайте интервал (`--timeframe`) и для первых прогонов ограничивайте список тикеров.
- Перед запуском убедитесь, что TimescaleDB доступна.
