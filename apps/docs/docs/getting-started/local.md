---
sidebar_position: 2
title: Local Setup
---

## Requirements

- Node.js `20.19.6` (from `.nvmrc`)
- Yarn `4.x`
- Docker + Docker Compose

## Install

```bash
corepack enable
nvm use
yarn
```

## Start Infrastructure

```bash
yarn infra-up
yarn doctor
```

Expected services:

- PostgreSQL/Timescale on `127.0.0.1:5432`
- Redis on `127.0.0.1:6379`
- Optional ML gRPC on `127.0.0.1:50051`

## Run the App

```bash
yarn dev
```

Open `http://localhost:3000`.

## Run With Infra in One Command

```bash
yarn dev:with-infra
```

## Useful Local Commands

```bash
yarn signals
yarn backtest
yarn results
yarn bot
```

## Common Errors

### `ECONNREFUSED 127.0.0.1:6379`

Redis is not running. Start infra:

```bash
yarn infra-up
```

### `ECONNREFUSED 127.0.0.1:5432`

Timescale/Postgres is not running. Start infra and verify:

```bash
yarn infra-up
yarn doctor
```
