---
title: Pine Script стратегия пошагово
---

Этот гайд показывает Pine-путь в TradeJS: реальная самостоятельная стратегия на Pine Script, встроенная в runtime как полноценная стратегия.

В TradeJS есть два пути написания стратегий:

- [TypeScript-стратегия через `StrategyAPI`](./ma-strategy-step-by-step)
- Pine-стратегия с отдельным `.pine` файлом (пример `AdaptiveMomentumRibbon` ниже)

## 1. Стратегия оформляется как отдельный модуль

`AdaptiveMomentumRibbon` лежит как обычная стратегия:

- `@tradejs/core`
- `@tradejs/core`
- `@tradejs/core`
- `@tradejs/core`
- `@tradejs/core`
- `@tradejs/core`

Pine-код хранится отдельно и загружается в `core.ts`.

## 2. Контракт Pine-сигналов для runtime

Runtime читает Pine `plot`-серии по имени. В Pine-скрипте должны быть явные выходы:

- `entryLong`
- `entryShort`
- `invalidated`
- плюс линии для figures (`kcMidline`, `kcUpper`, `kcLower`, `invalidationLevel`)

`core.ts` переводит эти значения в обычные решения TradeJS (`skip`, `entry`, `exit`), поэтому backtest/signals/AI/ML продолжают работать без изменений.

## 3. Runtime config в Redis

```bash
redis-cli JSON.SET users:root:strategies:AdaptiveMomentumRibbon:config '$' '{
  "ENV": "CRON",
  "INTERVAL": "15",
  "MAKE_ORDERS": false,
  "BACKTEST_PRICE_MODE": "mid",
  "AMR_MOMENTUM_PERIOD": 20,
  "AMR_BUTTERWORTH_SMOOTHING": 3,
  "AMR_WAIT_CLOSE": true,
  "AMR_SHOW_INVALIDATION_LEVELS": true,
  "AMR_SHOW_KELTNER_CHANNEL": true,
  "AMR_KC_LENGTH": 20,
  "AMR_KC_MA_TYPE": "EMA",
  "AMR_ATR_LENGTH": 14,
  "AMR_ATR_MULTIPLIER": 2,
  "AMR_EXIT_ON_INVALIDATION": true,
  "AMR_LOOKBACK_BARS": 400,
  "AMR_LINE_PLOTS": ["kcMidline", "kcUpper", "kcLower", "invalidationLevel"],
  "LONG": {"enable": true, "direction": "LONG", "TP": 2, "SL": 1},
  "SHORT": {"enable": true, "direction": "SHORT", "TP": 2, "SL": 1},
  "AI_ENABLED": false,
  "ML_ENABLED": false,
  "ML_THRESHOLD": 0.1,
  "MIN_AI_QUALITY": 3
}'
```

## 4. Backtest grid config

```bash
redis-cli JSON.SET users:root:backtests:configs:AdaptiveMomentumRibbon:amr-default '$' '{
  "ENV": ["BACKTEST"],
  "INTERVAL": ["15"],
  "MAKE_ORDERS": [true],
  "BACKTEST_PRICE_MODE": ["mid"],
  "AMR_MOMENTUM_PERIOD": [20],
  "AMR_BUTTERWORTH_SMOOTHING": [3],
  "AMR_WAIT_CLOSE": [true],
  "AMR_SHOW_INVALIDATION_LEVELS": [true],
  "AMR_SHOW_KELTNER_CHANNEL": [true],
  "AMR_KC_LENGTH": [20],
  "AMR_KC_MA_TYPE": ["EMA"],
  "AMR_ATR_LENGTH": [14],
  "AMR_ATR_MULTIPLIER": [2],
  "AMR_EXIT_ON_INVALIDATION": [true],
  "AMR_LOOKBACK_BARS": [400],
  "AMR_LINE_PLOTS": [["kcMidline", "kcUpper", "kcLower", "invalidationLevel"]],
  "LONG": [{"enable": true, "direction": "LONG", "TP": 2, "SL": 1}],
  "SHORT": [{"enable": true, "direction": "SHORT", "TP": 2, "SL": 1}],
  "AI_ENABLED": [false],
  "ML_ENABLED": [false],
  "ML_THRESHOLD": [0.1],
  "MIN_AI_QUALITY": [3]
}'
```

Важно: имя backtest-конфига должно начинаться со стратегии (`AdaptiveMomentumRibbon:*`).

## 5. Запуск и проверка

Бэктест:

```bash
npx @tradejs/cli backtest --user root --config AdaptiveMomentumRibbon:amr-default --connector bybit --tests 200 --parallel 4
```

Сигналы:

```bash
npx @tradejs/cli signals --user root --cacheOnly
```

В UI (`/routes/backtest`) проверьте:

- события входа/выхода AMR
- Pine-figures (`kcMidline`, `kcUpper`, `kcLower`, `invalidationLevel`)

## 6. Как добавить другую Pine-стратегию

1. Скопируйте папку `AdaptiveMomentumRibbon` под новое имя стратегии.
2. Замените `.pine` файл на вашу стратегию.
3. Сохраните явные `plot`-выходы для entry/exit (+ линии figures).
4. Привяжите эти `plot`-ы в `core.ts` к решениям TradeJS.
5. Зарегистрируйте manifest в `@tradejs/core`.

Так Pine-стратегии остаются самостоятельными модулями, равными TS-стратегиям по интеграции с runtime/backtest.
