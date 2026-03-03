---
sidebar_position: 3
title: Self-Hosted развертывание
---

Если вы хотите развернуть TradeJS на своем сервере, есть два рабочих сценария.

## Сценарий A: приложение как Node-процесс, инфраструктура в Docker

Подходит для простого старта.

1. Создайте `.env`:

```bash
cp .env.example .env
```

2. Для запуска в host-сети обычно используют такие значения:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
PG_HOST=127.0.0.1
PG_PORT=5432
ML_GRPC_ADDRESS=127.0.0.1:50051
```

3. Запустите сервисы и приложение:

```bash
yarn infra-up
yarn dev
```

## Сценарий B: полный Docker-стек

Подходит для production-like окружения.

```bash
docker compose up -d --build
```

Основные файлы:

- `docker-compose.yml`
- `docker-compose.db.yml`
- `Dockerfile`
- `Dockerfile.infer`

## Проверка после запуска

```bash
yarn doctor
docker compose ps
```

## Что важно для данных

Сохраняйте бэкапы:

- каталога `./data`,
- Docker volume с базой и Redis (`pgdata`, `redisdata`).
