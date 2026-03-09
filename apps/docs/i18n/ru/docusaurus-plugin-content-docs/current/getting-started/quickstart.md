---
sidebar_position: 2
title: Quickstart
---

Эта страница для внешних пользователей пакетов TradeJS (без клонирования репозитория).

## Что нужно заранее

- Node.js `20.19+`
- npm/yarn/pnpm
- Запущенные Redis и PostgreSQL/Timescale
- (опционально) ML gRPC сервис для ML-сценариев

## 1. Создайте проект и установите пакеты

```bash
mkdir tradejs-project
cd tradejs-project
npm init -y
npm i @tradejs/core @tradejs/cli
```

## 2. Добавьте `tradejs.config.ts`

```ts
import { defineConfig } from '@tradejs/core';

export default defineConfig({
  strategyPlugins: [],
  indicatorsPlugins: [],
});
```

## 3. Проверьте окружение

```bash
npx @tradejs/cli doctor
```

Обычно runtime ожидает:

- PostgreSQL/Timescale: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`
- ML gRPC (опционально): `127.0.0.1:50051`

## 4. Базовые команды на каждый день

```bash
npx @tradejs/cli signals
npx @tradejs/cli backtest
npx @tradejs/cli results
npx @tradejs/cli bot
```

## Если что-то не стартует

### Ошибка `ECONNREFUSED 127.0.0.1:6379`

Redis недоступен из вашего окружения.

### Ошибка `ECONNREFUSED 127.0.0.1:5432`

PostgreSQL/Timescale недоступен из вашего окружения.
