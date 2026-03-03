---
sidebar_position: 10
title: 'ML: как работает и настраивается'
---

## Общая схема

1. Бэктест (с `--ml`) пишет chunk-файлы.
2. `yarn ml-export` объединяет их в merged JSONL.
3. Train-скрипт режет merged-файл на `holdout/prod/walk-forward`.
4. Python train-контейнер обучает модель и пишет отчеты.
5. Runtime-инференс идет в gRPC (`ML_GRPC_ADDRESS`).

## Реальные команды

```bash
yarn backtest --config trendline --ml
yarn ml-export
yarn ml-inspect
yarn ml-train:trendline:xgboost
yarn ml-upload:prod
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
