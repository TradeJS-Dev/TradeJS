---
sidebar_position: 10
title: 'ML: как работает и настраивается'
---

## Общая схема

1. Бэктест (с `--ml`) пишет chunk-файлы.
2. `npx @tradejs/cli ml-export` объединяет их в merged JSONL.
3. Train-скрипт режет merged-файл на `holdout/prod/walk-forward`.
4. Python train-контейнер обучает модель и пишет отчеты.
5. Runtime-инференс идет в gRPC (`ML_GRPC_ADDRESS`).

## Реальные команды

```bash
npx @tradejs/cli backtest --config trendline --ml
npx @tradejs/cli ml-export
npx @tradejs/cli ml-inspect
npx @tradejs/cli ml-train:trendline:xgboost
```

## Пример `.env` для ML

```env
ML_GRPC_ADDRESS=127.0.0.1:50051
ML_TRAIN_RECENT_DAYS=60
ML_TRAIN_TEST_DAYS=30
ML_TRAIN_WALK_FORWARD_FOLDS=2
ML_TRAIN_FEATURE_PROFILE=all
ML_TRAIN_FEATURE_SET=enriched
ML_TRAIN_ENSEMBLE=1
ML_TRAIN_ENSEMBLE_MEMBERS=3
```

## Форматы файлов датасета

Исходные chunk-файлы:

```text
ml-dataset-<strategy>-<chunkId>.jsonl
```

Производные split-файлы:

```text
*.holdout-train.<key>.jsonl
*.holdout-test.<key>.jsonl
*.prod.<key>.jsonl
*.walk-forward-fold-<N>.train.<key>.jsonl
*.walk-forward-fold-<N>.test.<key>.jsonl
```

## Локальная цепочка артефактов (export -> train -> signals)

1. `npx @tradejs/cli backtest --ml` пишет chunk-файлы в локальную папку проекта:
   `data/ml/export/ml-dataset-<strategy>-chunk-<chunkId>.jsonl`
2. `npx @tradejs/cli ml-export` объединяет их в:
   `data/ml/export/ml-dataset-<strategy>-merged-<timestamp>.jsonl`
3. `npx @tradejs/cli ml-train:latest` читает export-файлы из `data/ml/export` и пишет model aliases в:
   `data/ml/models/<Strategy>.joblib`
   или ensemble aliases `data/ml/models/<Strategy>.modelN.joblib`
4. ML infer сервис должен читать ту же директорию моделей (`MODEL_DIR`).
5. `npx @tradejs/cli signals` (если в конфиге стратегии `ML_ENABLED=true`) отправляет `signal.strategy` в gRPC `Predict`.
   Inference-сервис загружает `<Strategy>.joblib` / `<Strategy>.modelN.joblib` для этой стратегии.

Если имя стратегии и префикс model alias совпадают, runtime автоматически использует обученную локальную модель.

## Качество и causality

- На train есть проверка lookahead leakage.
- Для отладки guard можно отключить:

```env
ML_TRAIN_DISABLE_CAUSALITY_GUARD=1
```

- В runtime используется та же trim-логика фич, что и в train.

## Что есть в отчетах

Каждый train-run сохраняет markdown и HTML с:

- holdout-метриками,
- walk-forward-метриками,
- таблицами порогов,
- TOP признаков на holdout.
