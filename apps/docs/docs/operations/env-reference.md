---
title: Environment Variables Reference
---

This page groups the most important environment variables by area.

## Application

- `APP_URL` - public app URL.
- `HOST` / `PORT` - HTTP binding for app process.
- `NODE_ENV` - `development` or `production`.
- `NEXTAUTH_SECRET` - required for session/token security.
- `NEXTAUTH_URL` - public URL used by auth callbacks.

## Data Services

- `REDIS_HOST`, `REDIS_PORT`
- `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`
- `ML_GRPC_ADDRESS` (for runtime inference)

## AI

- `OPENAI_API_KEY`
- `OPENAI_API_ENDPOINT` (optional; defaults to OpenAI endpoint)

## ML Training

- `ML_TRAIN_RECENT_DAYS`
- `ML_TRAIN_TEST_DAYS`
- `ML_TRAIN_WALK_FORWARD_FOLDS`
- `ML_TRAIN_FEATURE_PROFILE` (`all` or `robust`)
- `ML_TRAIN_FEATURE_SET` (`legacy` or `enriched`)
- `ML_TRAIN_ENSEMBLE`
- `ML_TRAIN_ENSEMBLE_MEMBERS`

## Practical Recommendations

- Keep `.env.example` safe and generic; never commit secrets.
- In production, inject secrets from a secret manager.
- For local setup, run `npx @tradejs/cli infra-init` once, then `npx @tradejs/cli infra-up`.
- Validate environment with `npx @tradejs/cli doctor` before enabling live orders.
