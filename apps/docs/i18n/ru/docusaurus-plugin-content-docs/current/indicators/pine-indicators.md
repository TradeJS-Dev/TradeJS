---
title: Как добавить Pine Script индикаторы
---

В TradeJS есть два пути добавления индикаторов:

- TypeScript indicator plugins (рекомендуется для переиспользуемых pane-индикаторов)
- Pine `plot`-линии внутри самостоятельной Pine-стратегии (для strategy-native визуализации/сигналов)

## 1. TypeScript-путь индикаторов

Используйте plugin-индикаторы, когда нужен переиспользуемый индикатор вне конкретной стратегии.

Гайд:

- `indicators/write-indicators`

## 2. Pine-путь индикаторов (внутри Pine-стратегии)

Для Pine-стратегий (пример: `AdaptiveMomentumRibbon`) линии индикаторов берутся из Pine `plot(...)` и конвертируются в `figures`.

Путь в коде:

- Pine-исходник: `packages/core/src/strategy/AdaptiveMomentumRibbon/adaptiveMomentumRibbon.pine`
- mapping в фигуры: `packages/core/src/strategy/AdaptiveMomentumRibbon/figures.ts`
- mapping в runtime-сигналы: `packages/core/src/strategy/AdaptiveMomentumRibbon/core.ts`

## 3. Добавьте новый Pine plot

Пример: добавить RSI в Pine-скрипт.

```pinescript
rsiValue = ta.rsi(close, 14)
plot(rsiValue, "rsi")
```

Затем добавьте его в конфиг стратегии:

```json
{
  "AMR_LINE_PLOTS": [
    "kcMidline",
    "kcUpper",
    "kcLower",
    "invalidationLevel",
    "rsi"
  ]
}
```

## 4. Проверка в backtest/signals

```bash
yarn backtest --user root --config AdaptiveMomentumRibbon:amr-default
```

или

```bash
yarn signals --user root --cacheOnly
```

Новая Pine-линия должна появиться в figures у сигналов/бэктеста.

## 5. Частые проблемы

- Линия не отображается:
  имя в конфиге не совпадает с `plot(..., "name")`.
- Линия некорректная или “плоская”:
  проверьте warmup в Pine и окно истории (`AMR_LOOKBACK_BARS`).
- Нет entry/exit:
  проверьте служебные plot-сигналы (`entryLong`, `entryShort`, `invalidated`).
