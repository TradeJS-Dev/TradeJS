---
title: Production Runbook
---

Use this runbook as a daily operational checklist.

## Daily Health Checks

1. `docker compose ps` or service manager status.
2. `npx @tradejs/cli doctor` (or equivalent in runtime environment).
3. Verify API responsiveness and basic UI pages.
4. Check Redis/Postgres connectivity and resource usage.

## Incident Triage

1. Identify failing layer: app, connectors, Redis, Postgres, ML, AI provider.
2. Capture logs first (do not restart immediately unless severe).
3. Confirm whether issue is global or symbol/strategy-specific.
4. Apply scoped mitigation.

## Restart Order (Typical)

1. Data services (`timescale`, `redis`)
2. ML inference service
3. App service
4. Reverse proxy / ingress if needed

## Rollback

- Keep previous image tags for `app` and `ml-infer`.
- Roll back app and model aliases independently when required.
- Verify runtime with `doctor` and smoke checks after rollback.
