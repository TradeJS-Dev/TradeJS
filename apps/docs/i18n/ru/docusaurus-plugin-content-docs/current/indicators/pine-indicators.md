---
title: Как добавить Pine Script индикаторы
---

В TradeJS Pine-индикаторы поддерживаются через `pinets` внутри Pine-стратегий.

Важный момент по архитектуре:

- Pine-индикаторы рисуются через `figures`, которые возвращает стратегия.
- Отдельные pane-индикаторы лучше делать как обычные indicator plugins (`indicators/write-indicators`).

## 1. Добавьте plot индикатора в Pine Script

Пример Pine-кода:

```pinescript
//@version=5
indicator("TradeJS Pine MA + RSI", overlay=true)

fast = ta.sma(close, 9)
slow = ta.sma(close, 21)
rsiValue = ta.rsi(close, 14)

entryLong = fast > slow and fast[1] <= slow[1]
entryShort = fast < slow and fast[1] >= slow[1]

plot(fast, "fast")
plot(slow, "slow")
plot(rsiValue, "rsi")
plot(entryLong ? 1 : 0, "entryLong")
plot(entryShort ? 1 : 0, "entryShort")
```

## 2. Зарегистрируйте ключи plot в конфиге стратегии

Для стратегии `PineScript` добавьте `rsi` в список линий:

```json
{
  "PINE_LINE_PLOTS": ["fast", "slow", "rsi"],
  "PINE_ENTRY_LONG_PLOT": "entryLong",
  "PINE_ENTRY_SHORT_PLOT": "entryShort"
}
```

## 3. Запустите signals или backtest

```bash
yarn signals --user root --cacheOnly
```

или

```bash
yarn backtest --user root --config PineScript:ma-cross
```

## 4. Где отображается индикатор

Pine plots конвертируются в line figures и отображаются в:

- графике сигнала (dashboard)
- графике сделок в backtest

Путь в коде:

- выполнение Pine: `packages/core/src/utils/pine.ts`
- конвертация в фигуры: `packages/core/src/strategy/PineScript/figures.ts`

## 5. Частые проблемы

- Линия не отображается:
  ключ в `PINE_LINE_PLOTS` не совпадает с именем `plot(..., "name")`.
- Линия “плоская”:
  проверьте warmup и lookback в Pine-скрипте.
- Нет входов:
  проверьте имена `PINE_ENTRY_LONG_PLOT` / `PINE_ENTRY_SHORT_PLOT`.
