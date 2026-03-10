---
title: Data Sync
---

В этой статье: как обновлять исторические данные через `npx @tradejs/cli backtest --updateOnly` и `npx @tradejs/cli continuity`, и как выбирать конкретную биржу.

Требование к локальной инфраструктуре:

```bash
npx @tradejs/cli infra-init
npx @tradejs/cli infra-up
```

После работы остановите локальную инфраструктуру: `npx @tradejs/cli infra-down`.

## 1. `npx @tradejs/cli backtest --updateOnly`

Используйте `backtest` в update-only режиме:

```bash
npx @tradejs/cli backtest --updateOnly
```

Источники:

- `@tradejs/cli`

Что делает команда:

- читает backtest config из Redis
- берет список тикеров через выбранный connector
- обновляет свечи в БД без запуска тестов

### Выбор биржи для update

Используйте `--connector` (`bybit|binance|coinbase`):

```bash
npx @tradejs/cli backtest --updateOnly --user root --config TrendLine:base --connector bybit --timeframe 15
npx @tradejs/cli backtest --updateOnly --user root --config TrendLine:base --connector binance --timeframe 15
npx @tradejs/cli backtest --updateOnly --user root --config TrendLine:base --connector coinbase --timeframe 15
```

Совет: добавьте `--tickers BTCUSDT,ETHUSDT`, чтобы ограничить набор символов.

## 2. `npx @tradejs/cli continuity`

`npx @tradejs/cli continuity` проверяет целостность истории и может автоматически чинить разрывы.

Источник:

- `@tradejs/cli`

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
npx @tradejs/cli continuity --user root --timeframe 15 --provider all
npx @tradejs/cli continuity --user root --timeframe 15 --provider bybit
npx @tradejs/cli continuity --user root --timeframe 15 --provider binance --tickers BTCUSDT,ETHUSDT
```

## 3. Когда какую команду использовать

- `backtest --updateOnly` — для регулярного обновления истории.
- `continuity` — когда подозреваете пропуски/битые диапазоны и нужно восстановление.

## 4. Операционные замечания

- `continuity` может быть тяжелой и деструктивной для затронутого symbol+interval (удаляет и перезаливает).
- Явно задавайте интервал (`--timeframe`) и для первых прогонов ограничивайте список тикеров.
- Перед запуском убедитесь, что TimescaleDB доступна.
