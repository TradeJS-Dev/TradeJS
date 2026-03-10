---
title: Как добавить Pine Script индикаторы
---

В TradeJS есть два пути добавления индикаторов:

- TypeScript indicator plugins (рекомендуется для переиспользуемых pane-индикаторов)
- Pine `plot`-линии внутри самостоятельной Pine-стратегии (для strategy-native визуализации/сигналов)

## 1. TypeScript-путь индикаторов

Используйте plugin-индикаторы, когда нужен переиспользуемый индикатор вне конкретной стратегии.

См. [Как писать свои индикаторы](./authoring).

## 2. Pine-путь индикаторов (внутри Pine-стратегии)

Для Pine-стратегий (пример: `AdaptiveMomentumRibbon`) линии индикаторов берутся из Pine `plot(...)` и конвертируются в `figures`.

Что нужно сделать на практике:

1. Добавить/переименовать нужные `plot(...)` серии в Pine-скрипте.
2. Указать имена этих plot в конфиге стратегии (`AMR_LINE_PLOTS`).
3. Запустить `backtest` или `signals`: выбранные plot появятся в `figures.lines`.

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
npx @tradejs/cli backtest --user root --config AdaptiveMomentumRibbon:amr-default
```

или

```bash
npx @tradejs/cli signals --user root --cacheOnly
```

Новая Pine-линия должна появиться в figures у сигналов/бэктеста.

## 5. Частые проблемы

- Линия не отображается:
  имя в конфиге не совпадает с `plot(..., "name")`.
- Линия некорректная или “плоская”:
  проверьте warmup в Pine и окно истории (`AMR_LOOKBACK_BARS`).
- Нет entry/exit:
  проверьте служебные plot-сигналы (`entryLong`, `entryShort`, `invalidated`).
