---
sidebar_position: 2
title: Локальный запуск
---

Эта страница — самый быстрый путь, чтобы поднять TradeJS у себя на машине.

## Что нужно заранее

- Node.js `20.19.6` (версия в `.nvmrc`)
- Yarn `4.x`
- Docker + Docker Compose

## Установка зависимостей

```bash
corepack enable
nvm use
yarn
```

## Поднять инфраструктуру

```bash
yarn infra-up
yarn doctor
```

После этого должны быть доступны:

- PostgreSQL/Timescale: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`
- (опционально) ML gRPC: `127.0.0.1:50051`

## Запустить приложение

```bash
yarn dev
```

Откройте `http://localhost:3000`.

Если удобнее одной командой:

```bash
yarn dev:with-infra
```

## Полезные команды на каждый день

```bash
yarn signals
yarn backtest
yarn results
yarn bot
```

## Если что-то не стартует

### Ошибка `ECONNREFUSED 127.0.0.1:6379`

Не поднят Redis. Обычно помогает:

```bash
yarn infra-up
```

### Ошибка `ECONNREFUSED 127.0.0.1:5432`

Не поднят Timescale/Postgres. Проверьте так:

```bash
yarn infra-up
yarn doctor
```
