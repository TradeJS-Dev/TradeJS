---
sidebar_position: 2
title: Quickstart
---

Эта страница для внешних пользователей пакетов TradeJS (без клонирования репозитория).

## Что нужно заранее

- Node.js `20.19+`
- npm/yarn/pnpm
- Установленный и запущенный Docker Desktop (или Docker Engine)
- Доступный Docker Compose plugin (`docker compose`)

## 1. Создайте проект и установите пакеты

```bash
mkdir tradejs-project
cd tradejs-project
npm init -y
npm i @tradejs/core @tradejs/base @tradejs/cli
```

## 2. Добавьте `tradejs.config.ts`

```ts
import { defineConfig } from '@tradejs/core/config';
import { basePreset } from '@tradejs/base';

export default defineConfig(basePreset, {});
```

Политика импортов для плагинов:

- импортируйте runtime/типы/хелперы/константы только из `@tradejs/core`
- избегайте внутренних алиасов (`@utils`, `@types`, `@constants`) и deep-imports (`@tradejs/core/*`)

## 3. Инициализируйте файлы dev-инфраструктуры

`infra-init` создает `docker-compose.dev.yml` в корне проекта один раз.
Если файл уже существует, команда его не перезаписывает.

```bash
npx @tradejs/cli infra-init
```

## 4. Поднимите dev-инфраструктуру

`infra-up` использует существующий `docker-compose.dev.yml` и поднимает:

- PostgreSQL/Timescale (`127.0.0.1:5432`)
- Redis (`127.0.0.1:6379`)

```bash
npx @tradejs/cli infra-up
```

Важно:

- `docker-compose.dev.yml` используется для локальной dev-инфраструктуры.
- `docker-compose.prod.yml` предназначен для production deployment и `infra-up` его не использует.

## 5. Проверьте окружение

```bash
npx @tradejs/cli doctor
```

Обычно runtime ожидает:

- PostgreSQL/Timescale: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`
- ML gRPC (опционально): `127.0.0.1:50051`

## 6. Базовые команды на каждый день

```bash
npx @tradejs/cli signals
npx @tradejs/cli backtest
npx @tradejs/cli results
npx @tradejs/cli bot
```

## 7. Остановите dev-инфраструктуру

```bash
npx @tradejs/cli infra-down
```

## Если что-то не стартует

### Ошибка `ECONNREFUSED 127.0.0.1:6379`

Redis недоступен из вашего окружения.

### Ошибка `ECONNREFUSED 127.0.0.1:5432`

PostgreSQL/Timescale недоступен из вашего окружения.
