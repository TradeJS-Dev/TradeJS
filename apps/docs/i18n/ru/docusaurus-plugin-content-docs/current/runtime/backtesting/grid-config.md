---
title: Grid-конфиг бэктеста для массового перебора параметров
---

В этой статье показано, как настроить grid-конфиг в Redis и запустить массовые бэктесты с перебором комбинаций параметров.

## 1. Как работает grid-бэктест

`yarn backtest` читает конфиг из Redis и строит декартово произведение массивов параметров.

Код:

- `packages/cli/src/scripts/backtest.ts`
- `packages/core/src/utils/grid.ts`

Ключевые правила:

- каждое поле grid-конфига должно быть массивом
- одна комбинация = одно значение из каждого поля
- число тестов до ограничения `--tests` = `кол-во_тикеров * кол-во_комбинаций`

## 2. Формат Redis-ключа

Используйте ключ:

- `users:<user>:backtests:configs:<Strategy>:<configName>`

Пример:

- `users:root:backtests:configs:AdaptiveMomentumRibbon:grid-v1`

Важно:

- `--config` должен быть в формате `<Strategy>:<configName>`
- имя стратегии берется из первой части до `:`

## 3. Пример grid-конфига

Пример для `AdaptiveMomentumRibbon`:

```bash
redis-cli JSON.SET users:root:backtests:configs:AdaptiveMomentumRibbon:grid-v1 '$' '{
  "ENV": ["BACKTEST"],
  "INTERVAL": ["15"],
  "MAKE_ORDERS": [true],
  "BACKTEST_PRICE_MODE": ["mid"],

  "AMR_MOMENTUM_PERIOD": [14, 20, 28],
  "AMR_BUTTERWORTH_SMOOTHING": [2, 3],
  "AMR_ATR_MULTIPLIER": [1.8, 2.2],

  "AMR_WAIT_CLOSE": [true],
  "AMR_SHOW_INVALIDATION_LEVELS": [true],
  "AMR_SHOW_KELTNER_CHANNEL": [true],
  "AMR_KC_LENGTH": [20],
  "AMR_KC_MA_TYPE": ["EMA"],
  "AMR_ATR_LENGTH": [14],
  "AMR_EXIT_ON_INVALIDATION": [true],
  "AMR_LOOKBACK_BARS": [300],
  "AMR_LINE_PLOTS": [["kcMidline", "kcUpper", "kcLower", "invalidationLevel"]],

  "LONG": [
    {"enable": true, "direction": "LONG", "TP": 1.5, "SL": 0.8},
    {"enable": true, "direction": "LONG", "TP": 2.0, "SL": 1.0}
  ],
  "SHORT": [
    {"enable": true, "direction": "SHORT", "TP": 2.0, "SL": 1.0}
  ],

  "AI_ENABLED": [false],
  "ML_ENABLED": [false],
  "ML_THRESHOLD": [0.1],
  "MIN_AI_QUALITY": [3]
}'
```

Количество комбинаций в примере:

- `3 * 2 * 2 * 2 * 1 = 24` комбинации
- если тикеров 120, полный suite будет `24 * 120 = 2880` тестов

## 4. Запуск массового бэктеста

```bash
yarn backtest --user root --config AdaptiveMomentumRibbon:grid-v1 --connector bybit --timeframe 15 --tests 3000 --parallel 6
```

Полезные флаги масштаба:

- `--tickers BTCUSDT,ETHUSDT,...`
- `--tickersLimit 100`
- `--exclude BTCUSDT,ETHUSDT`
- `--tests 3000` жесткий лимит на весь suite
- `--parallel 6` число воркеров

## 5. Проверка и итерации

Проверить конфиг:

```bash
redis-cli JSON.GET users:root:backtests:configs:AdaptiveMomentumRibbon:grid-v1
```

Посмотреть лучших кандидатов:

```bash
yarn results --strategy AdaptiveMomentumRibbon --coverage --user root
```

Промоутнуть лучшие конфиги в runtime:

```bash
yarn results --strategy AdaptiveMomentumRibbon --merge --user root
```

## 6. Частые ошибки

- скаляр вместо массива (`"INTERVAL": "15"` невалидно для grid)
- пустой массив в любом поле (`[]`) дает ноль комбинаций
- ключ без префикса стратегии (`AdaptiveMomentumRibbon:<name>`)
- слишком большой перебор без ограничения `--tests`

## 7. Связанные статьи

- `runtime/backtesting/overview`
- `runtime/backtesting/results-runtime-config`
- `runtime/backtesting/strategy-playbook`
