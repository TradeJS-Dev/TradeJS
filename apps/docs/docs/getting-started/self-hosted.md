---
sidebar_position: 3
title: Self-Hosted Deployment
---

## Option A: Node App + Docker Infra

Use this when you run app process directly and keep data services in Docker.

1. Prepare environment:

```bash
cp .env.example .env
```

2. For local host networking, use:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
PG_HOST=127.0.0.1
PG_PORT=5432
ML_GRPC_ADDRESS=127.0.0.1:50051
```

3. Start infra and app:

```bash
yarn infra-up
yarn dev
```

## Option B: Full Docker Stack

Use production-like stack with app, db, redis, ml-infer, nginx:

```bash
docker compose up -d --build
```

Main files:

- `docker-compose.yml`
- `docker-compose.db.yml`
- `Dockerfile`
- `Dockerfile.infer`

## Operational Checks

```bash
yarn doctor
docker compose ps
```

## Data and Volumes

Persistent data lives in:

- `./data`
- Docker volumes (`pgdata`, `redisdata`)

Backups should include both `./data` and DB/Redis volumes.
