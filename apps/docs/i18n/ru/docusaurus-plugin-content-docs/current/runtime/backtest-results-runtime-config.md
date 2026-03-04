---
title: Как применять результаты бэктестов в рантайме
---

В этой статье: как продвигать позитивные backtest-конфиги в runtime, как работает `yarn results`, и как выставляется `isConfigFromBacktest`.

## 1. Что делает `yarn results`

`yarn results` сканирует сохраненные тесты/статистику и собирает лучших кандидатов по символам для выбранной стратегии.

Источник:

- `packages/cli/src/scripts/results.ts`

Базовая команда:

```bash
yarn results --strategy TrendLine --coverage --user root
```

Полезные режимы:

- `--update`: полностью перезаписать сохраненные strategy results
- `--merge`: обновить только символы, где новый результат лучше сохраненного
- `--clear`: удалить сохраненные promoted results

Примеры:

```bash
yarn results --strategy TrendLine --merge --user root
yarn results --strategy TrendLine --update --user root
yarn results --strategy TrendLine --clear --user root
```

## 2. Где хранится promoted config

Промотированные конфиги по символам хранятся в ключе:

- `users:<user>:strategies:<strategy>:results`

Для каждого символа сохраняются:

- `config` (конфиг стратегии для символа)
- `stats` (метрики бэктеста)

## 3. Приоритет конфигурации в рантайме

Конфиг в runtime собирается в таком порядке (`resolveStrategyConfig`):

1. дефолты стратегии (`strategy/<Strategy>/config.ts`)
2. base config, переданный в strategy creator
3. user runtime config (`users:<user>:strategies:<strategy>:config`)
4. promoted per-symbol config из `users:<user>:strategies:<strategy>:results`

Когда применяется шаг 4, runtime ставит:

- `isConfigFromBacktest = true`

Код:

- `packages/core/src/utils/strategyHelpers/config.ts`
- `packages/core/src/utils/strategyRuntime.ts`

## 4. Как используется `isConfigFromBacktest`

`isConfigFromBacktest` попадает в сигнал и может использоваться в UI/Telegram/debug-потоке.

Путь в коде:

- сбор сигнала: `packages/core/src/utils/strategyHelpers/signalBuilders.ts`
- форматирование Telegram: `packages/core/src/utils/signals.ts`

Поведение:

- если для символа есть promoted config: `isConfigFromBacktest: true`
- если записи нет: используется base/user config и `isConfigFromBacktest: false`

## 5. Рекомендуемый workflow

1. Прогоните бэктесты по сетке параметров стратегии.
2. Выполните `yarn results --strategy <Strategy> --coverage`.
3. Для продакшена сначала используйте `--merge` (безопаснее полной перезаписи).
4. Запустите `yarn signals` / `yarn bot` и проверьте сигналы с `isConfigFromBacktest=true`.
5. Повторяйте promotion после новых бэктестов.

## 6. Важные замечания

- `--coverage` сейчас считает покрытие относительно набора тикеров ByBit.
- `--merge` сохраняет текущие promoted символы, обновляя только реально лучшие.
