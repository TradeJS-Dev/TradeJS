---
title: Как писать свои индикаторы
---

В этой статье показано, как добавить свой индикатор и вывести его в графике TradeJS.

В TradeJS есть два пути индикаторов:

- TypeScript plugin-индикаторы (эта статья)
- Pine `plot`-индикаторы внутри Pine-стратегий (`indicators/pine`)

## 1. Создайте пакет плагина индикаторов

TradeJS загружает индикаторы из плагинов через `tradejs.config.ts`.

В пакете плагина экспортируйте `indicatorEntries`:

```ts
import type { IndicatorPluginEntry } from '@tradejs/framework';
import { defineIndicatorPlugin } from '@tradejs/framework';

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

Пример в репозитории:

- `examples/sandbox/src/index.ts`

## 2. Подключите плагин в `tradejs.config.ts`

```ts
import { defineConfig } from '@tradejs/framework';

export default defineConfig({
  indicatorsPlugins: ['@your-scope/tradejs-indicators-pack'],
});
```

## 3. Запустите приложение

```bash
yarn dev
```

Реестр плагинов поднимается в core, и значения индикатора попадают в history при загрузке данных графика.

## 4. Выведите индикатор на графике

Отрисовка управляется `renderer`:

- pane и высота
- тип фигуры (`line` / `bar`)
- цвет/толщина/пунктир
- константы (уровни)

Chart UI автоматически строит оверлеи из renderer-описаний.

## 5. Чеклист дебага

- Индикатор не виден:
  проверьте, что пакет есть в `indicatorsPlugins`.
- Пустые значения:
  убедитесь, что `compute` возвращает конечные числа и корректно обрабатывает warmup.
- Неправильная отрисовка:
  сверьте `renderer.figures[].key` с ключами истории, которые реально пишутся.
