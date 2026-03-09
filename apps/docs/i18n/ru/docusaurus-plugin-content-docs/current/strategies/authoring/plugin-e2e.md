---
title: Plugin-разработка от начала до конца
---

Этот гайд описывает полный цикл: от локальной разработки плагина до повторного использования.

## 1. Создайте пакет плагина

- Пакет должен экспортировать `strategyEntries` и/или `indicatorEntries`.
- Используйте типы из `@tradejs/core`.

## 2. Реализуйте стратегию или индикатор

- Strategy plugin: `manifest` + `creator`.
- Indicator plugin: `compute` + опциональный `renderer`.

## 3. Подключите плагин в проекте

Добавьте пакет в `tradejs.config.ts`:

```ts
export default defineConfig({
  strategyPlugins: ['@scope/my-plugin'],
  indicatorsPlugins: ['@scope/my-plugin'],
});
```

## 4. Проверьте локально

- Запустите app/docs.
- Прогоните `signals` и/или `backtest`.

## 5. Публикация

- Обновите версию и changelog.
- Опубликуйте в npm/private registry.
- Зафиксируйте версию плагина в production.
