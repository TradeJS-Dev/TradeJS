---
title: Справочник переменных окружения
---

На этой странице собраны основные переменные окружения по группам.

## Приложение

- `APP_URL` — публичный URL приложения.
- `HOST` / `PORT` — адрес и порт запуска.
- `NODE_ENV` — `development` или `production`.
- `NEXTAUTH_SECRET` — обязательный секрет для auth-сессий.
- `NEXTAUTH_URL` — публичный URL для auth callback.

## Сервисы данных

- `REDIS_HOST`, `REDIS_PORT`
- `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`
- `ML_GRPC_ADDRESS` (для runtime-инференса)

## AI

- `OPENAI_API_KEY`
- `OPENAI_API_ENDPOINT` (необязательно)

## Обучение ML

- `ML_TRAIN_RECENT_DAYS`
- `ML_TRAIN_TEST_DAYS`
- `ML_TRAIN_WALK_FORWARD_FOLDS`
- `ML_TRAIN_FEATURE_PROFILE` (`all` или `robust`)
- `ML_TRAIN_FEATURE_SET` (`legacy` или `enriched`)
- `ML_TRAIN_ENSEMBLE`
- `ML_TRAIN_ENSEMBLE_MEMBERS`

## Практические рекомендации

- Не храните секреты в репозитории.
- Для продакшена используйте secret manager.
- Перед live-запуском проверяйте окружение через `yarn doctor`.
