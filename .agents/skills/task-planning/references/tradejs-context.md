# TradeJS: границы, стек и проверки

Пути к коду и командам ниже отсчитываются от корня репозитория `investing`
с [AGENTS.md](../../../../AGENTS.md). Соседние репозитории указаны относительно
общего workspace `~/dev/tradejs`.
Это снимок конфигурации на 29 октября 2026 года. Перед применением сверяй
выбранный репозиторий: правила пакета и текущая конфигурация имеют приоритет.
Из корня workspace команды `investing` не запускаются.

## Владение кодом

- `apps/app` — устанавливаемый веб-интерфейс и API Next.js.
- `packages/core` — браузерно-безопасные общие возможности;
  `node` — серверный runtime; `infra` — Redis, Timescale, сеть и IO;
  `types` — общие контракты; `cli` — команды и их связывание.
- Поведение одной стратегии меняется в соответствующем `tradejs-strategy-*`,
  общие нейтральные средства стратегий — в `tradejs-strategy-kit`.
- Личные исследования, `.env`, данные и runtime-композиция принадлежат
  `tradejs-project`; операции backtest/replay/research выполняются оттуда.
- Публичные статьи и сайт принадлежат `tradejs-docs` и `tradejs-site`.
  Эти навыки не задают им версии и команды по аналогии с приложением:
  сначала читай их собственные инструкции и конфигурацию.

Не создавай параллельную копию исследовательских навыков из
`.codex/skills`: это отдельный источник устанавливаемого Project
bundle. Общие инженерные навыки этого репозитория находятся в `.agents/skills`.

## Проверенный стек investing

По [корневому package.json](../../../../package.json) и
[package.json приложения](../../../../apps/app/package.json):

| Область | Версия или настройка |
| --- | --- |
| Node.js | `engines: 24.x`, `.nvmrc: 24.17.0` |
| Yarn | `4.13.0`, workspaces `apps/*`, `packages/*` |
| TypeScript | приложение `5.9.3`, корень `^5.9`, `strict: true` |
| React / React DOM | приложение `19.2.8` |
| Next.js | `16.2.11`, App Router в `apps/app/src/app` |
| UI и состояние | Chakra UI `3.36.1`, Zustand `5.0.14`, next-auth `5.0.0-beta.30` |
| Тесты | Jest `^29.7.0`, `next/jest`, jsdom `30.0.0-beta.3`, Testing Library React `^16.3.2` |
| Браузер | `@playwright/test ^1.61.1`, Chromium |
| Стиль | ESLint `^9.39.5`, flat config; Prettier `^3.2.5`, одинарные кавычки и trailing commas |

Точные разрешённые версии диапазонов проверяй в lock-файле при работе с API.
Сборками управляет `turbo.json`; это не основание считать sandbox workspace.

## Импорты и интерфейс

У `@tradejs/core`, `@tradejs/node`, `@tradejs/infra` и
`@tradejs/strategy-kit` используются явные публичные subpaths без корневого
экспорта. Не импортируй чужие `src`/`dist`. `@tradejs/types` используется для
общих контрактов. В `core` действуют локальные `#utils/*`, `#constants`,
в приложении — `#app/*`, `#actions/*`, `#store`, `#shared/*`, `#ui`,
`#components/*`; сверяй `imports` конкретного пакета.

UI-компоненты находятся в `apps/app/src/app/components/UI`, общие составные
компоненты — в `components/Shared`, страницы — в `routes`, API — в `api`,
состояние — в `store`. `provider.tsx` задаёт Chakra system, тёмную тему и
SessionProvider. Не добавляй второй provider или словарь маршрутов ради
внешнего рецепта. Текущий URL и его параметры проверяй по вызывающему коду.

## Команды investing

Рабочий каталог для всех строк таблицы — корень репозитория `investing`. Команды ниже проверены
по конфигурации; наличие в таблице не означает успешного выполнения.

| Назначение | Команда |
| --- | --- |
| Адресный Jest | `yarn unit --runInBand --runTestsByPath <путь-к-тесту>`; вместо обозначения подставь существующий путь от `investing` |
| Все unit-тесты | `yarn unit` |
| Типы приложения, включая тесты | `yarn workspace @tradejs/app typecheck` |
| Типы workspace | `yarn typecheck` |
| Границы пакетов | `yarn architecture` |
| Сборка | `yarn build` |
| Линтер | `yarn lint` |
| Форматирование после правок кода | `yarn prettify`; изменяет `apps`, `packages`, `examples`, проверяй посторонний diff |
| Полная проверка | `yarn checks` |
| Исследовательский контур при его изменении | `yarn research:core:test`, `yarn research:core:coverage` |

`yarn checks` включает `prettify`, `architecture`, `build`, `lint`,
`typecheck`, `sandbox:typecheck:source`, `unit:coverage`. После его успеха на
том же diff не повторяй составные команды без новой причины. При изменении
публичных импортов нужны типы, сборка и тесты потребителей; одних Jest aliases
недостаточно. Порог покрытия уже задан в `jest.config.js`; не снижай его ради
прохода и не добавляй произвольные цели метрик.

## Тесты и CI

Тесты живут у владельца в `__tests__`, также обнаруживаются `*.test.ts(x)` и
`*.spec.ts(x)` по `jest.config.js`. Настройка — `next/jest` с
`dir: './apps/app'` и `jest.setup.js`; для Node-кода сверяй окружение соседних
тестов. Примеры: `apps/app/src/app/routes/derivatives/__tests__/useDerivativesDashboard.test.tsx`
проверяет поздний ответ, `components/Shared/Filters/__tests__/lazyOpen.test.tsx`
— ленивую загрузку. Они иллюстрируют отдельные контракты, а не обязательную
форму всех тестов.

Браузерная конфигурация — `playwright.config.ts`, тесты в `e2e`,
`QUICKSTART_E2E_URL` или `http://127.0.0.1:3100`, `trace: retain-on-failure`.
В ней нет `webServer`: адресный запуск требует заранее подготовленной
подходящей сборки. Подробности — в
[браузерных проверках](../../task-unit-test-coverage/references/browser-coverage.md).

`examples/sandbox` находится вне workspace-графа и использует опубликованные
пакеты. `yarn sandbox:e2e` запускает CLI/расчётные сценарии, а не браузер.
Успех sandbox на npm-пакетах не доказывает проверку локального исходного diff.

В `.github/workflows/publish-images.yml` CI выполняет `yarn checks`, затем
проверяет beta через `quickstart:e2e` и sandbox перед продвижением beta.
Этот workflow также публикует пакеты и образы: не запускай его как обычную
проверку. Локальный успех не доказывает успех CI и не разрешает релиз.
