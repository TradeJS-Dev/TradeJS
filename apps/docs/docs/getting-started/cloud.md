---
sidebar_position: 4
title: Cloud Usage
---

## Current Cloud Endpoint

TradeJS production endpoint:

- `https://aleksnick01inv.fvds.ru/`

## Typical Cloud Flow

1. Prepare `.env` with production keys/secrets.
2. Build and run stack on server (`docker compose up -d --build`).
3. Verify app, db, redis, ml-infer health.
4. Run `yarn doctor` inside runtime environment.

## Security Checklist

- Set strong `NEXTAUTH_SECRET`.
- Restrict network access to DB/Redis ports.
- Store API keys in secret manager, not in git.
- Use HTTPS termination (nginx + certbot in provided stack).

## Update Strategy

- Pull latest code.
- Rebuild containers.
- Run health checks before enabling live orders.
- Keep rollback image tags for `app` and `ml-infer`.
