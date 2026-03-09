---
title: Обучение ML-модели
---

`npx @tradejs/cli ml-train:latest` запускает интерактивный/селективный train по актуальным export-файлам и автоматически готовит holdout/prod/walk-forward split.

Внешний интерфейс:

- `@tradejs/cli`
- настроенный у вас ML train runtime (container/service)

## Что делает команда

1. Выбор стратегии и типа модели.
2. Выбор latest dataset (или merge нескольких base export, если задано).
3. Подготовка derived split-файлов:

- `*.holdout-train.<key>.jsonl`
- `*.holdout-test.<key>.jsonl`
- `*.prod.<key>.jsonl`
- `*.walk-forward-fold-<N>.train.<key>.jsonl`
- `*.walk-forward-fold-<N>.test.<key>.jsonl`

4. Кэширование split по детерминированному ключу/hash.
5. Проверка causality guard по timestamp-like фичам.
6. Запуск настроенного ML train runtime.

## Команды

```bash
npx @tradejs/cli ml-train:latest
npx @tradejs/cli ml-train:latest --strategy TrendLine --model xgboost
```

Неинтерактивные опции:

- `--strategy`
- `--model` (`catboost|random_forest|extra_trees|xgboost|lightgbm`)
- `--latestOnly`

## Основные env-параметры

Окна и split:

- `ML_TRAIN_RECENT_DAYS`
- `ML_TRAIN_TEST_DAYS`
- `ML_TRAIN_WALK_FORWARD_FOLDS`

Ensemble/profile:

- `ML_TRAIN_ENSEMBLE`
- `ML_TRAIN_FORCE_ENSEMBLE`
- `ML_TRAIN_NO_ENSEMBLE`
- `ML_TRAIN_FEATURE_PROFILE`

Causality:

- `ML_TRAIN_DISABLE_CAUSALITY_GUARD=1` (только для отладки)

Incremental mode:

- `ML_TRAIN_INCREMENTAL_THRESHOLD_GB`
- `ML_TRAIN_INCREMENTAL`
- `ML_TRAIN_NO_INCREMENTAL`
- `ML_TRAIN_CHUNK_SIZE`
- `ML_TRAIN_INCREMENTAL_ITERATIONS`

Логи/отладка:

- `ML_TRAIN_DEBUG=1`
- `ML_TRAIN_HEARTBEAT_SEC`
- `ML_TRAIN_DOCKER_NO_OUTPUT_TIMEOUT_SEC`

## Безопасный режим Redis

В референсном deployment используется safety-wrapper:

- Redis приостанавливается перед train
- Redis поднимается обратно при любом завершении (успех/ошибка/interrupt)

## Артефакты на выходе

- model aliases (`<Strategy>.joblib`, ensemble aliases)
- eval/prod snapshots
- sidecar metrics JSON
- markdown/html отчеты
- metadata split (`*.windows.<key>.meta.json`)
