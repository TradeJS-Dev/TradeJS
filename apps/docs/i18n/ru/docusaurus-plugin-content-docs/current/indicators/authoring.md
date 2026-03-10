---
title: Как писать свои индикаторы
---

В этой статье показано, как добавить свой индикатор и вывести его в графике TradeJS.

В TradeJS есть два пути индикаторов:

- TypeScript plugin-индикаторы (эта статья)
- [Pine `plot`-индикаторы внутри Pine-стратегий](./pine)

## 1. Создайте пакет плагина индикаторов

TradeJS загружает индикаторы из плагинов через `tradejs.config.ts`.

В пакете плагина экспортируйте `indicatorEntries`:

```ts
import type { IndicatorPluginEntry } from '@tradejs/core';
import { defineIndicatorPlugin } from '@tradejs/core';

export const indicatorEntries = defineIndicatorPlugin({
  indicatorEntries: [
    {
      indicator: {
        id: 'sandboxMomentum',
        label: 'Sandbox Momentum',
        enabled: false,
      },
      historyKey: 'sandboxMomentum',
      compute: ({ data }) => {
        const last = data[data.length - 1];
        const prev = data[data.length - 2];
        if (!last || !prev || prev.close === 0) {
          return null;
        }
        return ((last.close - prev.close) / prev.close) * 100;
      },
      renderer: {
        shortName: 'SBX MOM',
        minHeight: 120,
        figures: [
          {
            key: 'sandboxMomentum',
            title: 'Sandbox Momentum: ',
            type: 'line',
            color: '#f59e0b',
          },
          {
            key: 'sandboxMomentumZero',
            title: 'Zero: ',
            type: 'line',
            color: '#94a3b8',
            dashed: true,
            constant: 0,
          },
        ],
      },
    } satisfies IndicatorPluginEntry,
  ],
}).indicatorEntries;
```

## 2. Подключите плагин в `tradejs.config.ts`

```ts
import { defineConfig } from '@tradejs/core';

export default defineConfig({
  indicatorsPlugins: ['@your-scope/tradejs-indicators-pack'],
});
```

## 3. Перезапустите runtime/UI

Перезапустите ваш runtime/UI TradeJS, чтобы он подхватил изменения в реестре плагинов.

## 4. Выведите индикатор на графике

`renderer` нужно объявить в `indicatorEntries`, а дальше проброс делается автоматически:

1. Бэкенд отдает `renderers` в метаданных индикаторов.
2. Фронтенд сохраняет renderer-описания в состоянии индикаторов.
3. Слой графика создает pane/figures по renderer-описанию.

Минимальная рабочая связка:

```ts
{
  historyKey: 'sandboxMomentum',
  compute: ({ data }) => {
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    if (!last || !prev || prev.close === 0) return null;
    return ((last.close - prev.close) / prev.close) * 100;
  },
  renderer: {
    shortName: 'SBX MOM',
    paneId: 'sandbox_momentum_pane',
    minHeight: 120,
    figures: [
      { key: 'sandboxMomentum', type: 'line', color: '#f59e0b' },
      { key: 'sandboxMomentumZero', type: 'line', constant: 0, dashed: true },
    ],
  },
}
```

- `renderer.figures[].key` должен совпадать с ключом в свечах (обычно `historyKey`).
- Для горизонтальных уровней используйте `constant`: тогда значение не нужно писать в `compute`.
- После этого просто включите индикатор в UI (Indicators), панель/линии появятся автоматически.

## 5. Чеклист дебага

- Индикатор не виден:
  проверьте, что пакет есть в `indicatorsPlugins`.
- Пустые значения:
  убедитесь, что `compute` возвращает конечные числа и корректно обрабатывает warmup.
- Неправильная отрисовка:
  сверьте `renderer.figures[].key` с ключами истории, которые реально пишутся.
