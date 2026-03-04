---
title: Runtime Playbook (TrendLine + AdaptiveMomentumRibbon)
---

Эта шпаргалка содержит copy-paste команды для текущей конфигурации:

- user: `root`
- connector: `bybit`
- timeframe: `15`
- стратегии: `TrendLine`, `AdaptiveMomentumRibbon`

## 1. Проверка доступных backtest-конфигов

```bash
redis-cli --scan --pattern 'users:root:backtests:configs:TrendLine:*'
redis-cli --scan --pattern 'users:root:backtests:configs:AdaptiveMomentumRibbon:*'
```

Берите ключи из вывода как значения `--config` в командах ниже.

## 2. TrendLine: Backtest -> Promote -> Runtime

Бэктест:

```bash
yarn backtest --user root --config TrendLine:base --connector bybit --timeframe 15 --tests 500 --parallel 4
```

Посмотреть лучших кандидатов:

```bash
yarn results --strategy TrendLine --coverage --user root
```

Промоутнуть положительные конфиги в runtime (`users:root:strategies:TrendLine:results`):

```bash
yarn results --strategy TrendLine --merge --user root
```

Запустить runtime-сигналы с promoted-конфигом:

```bash
yarn signals --user root --cacheOnly --timeframe 15
```

Быстрая проверка, что применился promoted config (`isConfigFromBacktest=true`):

```bash
KEY=$(redis-cli --scan --pattern 'store:signals:BTCUSDT:*' | tail -n 1)
redis-cli JSON.GET "$KEY" '$.isConfigFromBacktest'
```

## 3. AdaptiveMomentumRibbon: Backtest -> Promote -> Runtime

Бэктест:

```bash
yarn backtest --user root --config AdaptiveMomentumRibbon:amr-default --connector bybit --timeframe 15 --tests 200 --parallel 4
```

Посмотреть лучших кандидатов:

```bash
yarn results --strategy AdaptiveMomentumRibbon --coverage --user root
```

Промоутнуть положительные конфиги в runtime (`users:root:strategies:AdaptiveMomentumRibbon:results`):

```bash
yarn results --strategy AdaptiveMomentumRibbon --merge --user root
```

Запустить runtime-сигналы с promoted-конфигом:

```bash
yarn signals --user root --cacheOnly --timeframe 15
```

Опциональная проверка полезной нагрузки AMR в сигнале:

```bash
KEY=$(redis-cli --scan --pattern 'store:signals:BTCUSDT:*' | tail -n 1)
redis-cli JSON.GET "$KEY" '$.additionalIndicators.amr'
```

## 4. Команды прокачки данных (ByBit)

Регулярное обновление истории:

```bash
yarn update-history -- --user root --config TrendLine:base --connector bybit --timeframe 15
```

Проверка целостности и ремонт разрывов:

```bash
yarn continuity --user root --timeframe 15 --provider bybit
yarn continuity --user root --timeframe 15 --provider bybit --tickers BTCUSDT,ETHUSDT
```

## 5. Откат promoted results

```bash
yarn results --strategy TrendLine --clear --user root
yarn results --strategy AdaptiveMomentumRibbon --clear --user root
```

## 6. Связанные статьи

- `runtime/backtest-results-runtime-config`
- `runtime/data-continuity-update-history`
- `strategies/pine-strategy-step-by-step`
