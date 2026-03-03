---
title: Pine Script стратегия пошагово
---

Эта статья показывает, как добавить и запустить стратегию на Pine Script через встроенную runtime-стратегию `PineScript`.

## 1. Контракт runtime остается прежним

`PineScript` стратегия возвращает стандартные решения TradeJS:

- `skip`
- `entry`
- `exit`

Поэтому AI/ML-гейты, политика ордеров и API остаются совместимыми.

Ключевые файлы:

- `packages/core/src/strategy/PineScript/core.ts`
- `packages/core/src/utils/pine.ts`

## 2. Подготовьте Pine Script

Используйте скрипт с сигналами входа/выхода:

```pinescript
//@version=5
indicator("TradeJS Pine MA Cross", overlay=true)

fast = ta.sma(close, 9)
slow = ta.sma(close, 21)

entryLong = fast > slow and fast[1] <= slow[1]
entryShort = fast < slow and fast[1] >= slow[1]

plot(fast, "fast")
plot(slow, "slow")
plot(entryLong ? 1 : 0, "entryLong")
plot(entryShort ? 1 : 0, "entryShort")
```

## 3. Сохраните runtime config в Redis

```bash
redis-cli JSON.SET users:root:strategies:PineScript:config '$' '{
  "ENV": "CRON",
  "INTERVAL": "15",
  "MAKE_ORDERS": false,
  "BACKTEST_PRICE_MODE": "mid",
  "PINE_SCRIPT": "//@version=5\\nindicator(\"TradeJS Pine MA Cross\", overlay=true)\\nfast = ta.sma(close, 9)\\nslow = ta.sma(close, 21)\\nentryLong = fast > slow and fast[1] <= slow[1]\\nentryShort = fast < slow and fast[1] >= slow[1]\\nplot(fast, \"fast\")\\nplot(slow, \"slow\")\\nplot(entryLong ? 1 : 0, \"entryLong\")\\nplot(entryShort ? 1 : 0, \"entryShort\")",
  "PINE_SCRIPT_INPUTS": {},
  "PINE_LOOKBACK_BARS": 300,
  "PINE_ENTRY_LONG_PLOT": "entryLong",
  "PINE_ENTRY_SHORT_PLOT": "entryShort",
  "PINE_EXIT_LONG_PLOT": "",
  "PINE_EXIT_SHORT_PLOT": "",
  "PINE_LINE_PLOTS": ["fast", "slow"],
  "LONG": {"enable": true, "direction": "LONG", "TP": 2, "SL": 1, "minRiskRatio": 1.5},
  "SHORT": {"enable": true, "direction": "SHORT", "TP": 2, "SL": 1, "minRiskRatio": 1.5},
  "FEE_PERCENT": 0.005,
  "MAX_LOSS_VALUE": 10,
  "MAX_CORRELATION": 0.45,
  "TRADE_COOLDOWN_MS": 0,
  "AI_ENABLED": false,
  "ML_ENABLED": false,
  "ML_THRESHOLD": 0.1,
  "MIN_AI_QUALITY": 3
}'
```

## 4. Сохраните backtest grid config

```bash
redis-cli JSON.SET users:root:backtests:configs:PineScript:ma-cross '$' '{
  "ENV": ["BACKTEST"],
  "INTERVAL": ["15"],
  "MAKE_ORDERS": [true],
  "BACKTEST_PRICE_MODE": ["mid"],
  "PINE_SCRIPT": ["//@version=5\\nindicator(\"TradeJS Pine MA Cross\", overlay=true)\\nfast = ta.sma(close, 9)\\nslow = ta.sma(close, 21)\\nentryLong = fast > slow and fast[1] <= slow[1]\\nentryShort = fast < slow and fast[1] >= slow[1]\\nplot(fast, \"fast\")\\nplot(slow, \"slow\")\\nplot(entryLong ? 1 : 0, \"entryLong\")\\nplot(entryShort ? 1 : 0, \"entryShort\")"],
  "PINE_SCRIPT_INPUTS": [{}],
  "PINE_LOOKBACK_BARS": [300],
  "PINE_ENTRY_LONG_PLOT": ["entryLong"],
  "PINE_ENTRY_SHORT_PLOT": ["entryShort"],
  "PINE_EXIT_LONG_PLOT": [""],
  "PINE_EXIT_SHORT_PLOT": [""],
  "PINE_LINE_PLOTS": [["fast", "slow"]],
  "LONG": [{"enable": true, "direction": "LONG", "TP": 2, "SL": 1, "minRiskRatio": 1.5}],
  "SHORT": [{"enable": true, "direction": "SHORT", "TP": 2, "SL": 1, "minRiskRatio": 1.5}],
  "FEE_PERCENT": [0.005],
  "MAX_LOSS_VALUE": [10],
  "MAX_CORRELATION": [0.45],
  "TRADE_COOLDOWN_MS": [0],
  "AI_ENABLED": [false],
  "ML_ENABLED": [false],
  "ML_THRESHOLD": [0.1],
  "MIN_AI_QUALITY": [3]
}'
```

## 5. Запустите и проверьте

Бэктест:

```bash
yarn backtest --user root --config PineScript:ma-cross --connector bybit --tests 200 --parallel 4
```

Сигналы:

```bash
yarn signals --user root --cacheOnly
```

## 6. Проверьте в приложении

1. Запустите приложение: `yarn dev`
2. Откройте `/routes/backtest`
3. Выберите стратегию `PineScript`
4. Откройте карточку теста и проверьте:
   - события entry/exit
   - линии Pine (`fast`, `slow`) в figures

## 7. Как расширять

- Добавляйте новые `plot(..., "name")` и включайте их в `PINE_LINE_PLOTS`.
- Добавляйте явные выходы через `PINE_EXIT_LONG_PLOT` / `PINE_EXIT_SHORT_PLOT`.
- Настраивайте риск через блоки `LONG` / `SHORT`.
