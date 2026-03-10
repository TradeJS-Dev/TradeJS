---
title: Как применять результаты бэктестов в рантайме
---

В этой статье: как продвигать позитивные backtest-конфиги в runtime, как работает `npx @tradejs/cli results`, и как выставляется `isConfigFromBacktest`.

## 1. Что делает `npx @tradejs/cli results`

`npx @tradejs/cli results` сканирует сохраненные тесты/статистику и собирает лучших кандидатов по символам для выбранной стратегии.

Базовая команда:

```bash
npx @tradejs/cli results --strategy TrendLine --coverage --user root
```

Полезные режимы:

- `--update`: полностью перезаписать сохраненные strategy results
- `--merge`: обновить только символы, где новый результат лучше сохраненного
- `--clear`: удалить сохраненные promoted results

Примеры:

```bash
npx @tradejs/cli results --strategy TrendLine --merge --user root
npx @tradejs/cli results --strategy TrendLine --update --user root
npx @tradejs/cli results --strategy TrendLine --clear --user root
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

## 4. Как используется `isConfigFromBacktest`

`isConfigFromBacktest` попадает в сигнал и может использоваться в UI/Telegram/debug-потоке.

Поведение:

- если для символа есть promoted config: `isConfigFromBacktest: true`
- если записи нет: используется base/user config и `isConfigFromBacktest: false`

## 5. Рекомендуемый workflow

1. Прогоните бэктесты по сетке параметров стратегии.
2. Выполните `npx @tradejs/cli results --strategy <Strategy> --coverage`.
3. Для продакшена сначала используйте `--merge` (безопаснее полной перезаписи).
4. Запустите `npx @tradejs/cli signals` / `npx @tradejs/cli bot` и проверьте сигналы с `isConfigFromBacktest=true`.
5. Повторяйте promotion после новых бэктестов.

## 6. Важные замечания

- `--coverage` сейчас считает покрытие относительно набора тикеров ByBit.
- `--merge` сохраняет текущие promoted символы, обновляя только реально лучшие.
