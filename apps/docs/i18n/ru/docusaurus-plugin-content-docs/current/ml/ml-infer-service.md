---
title: ML infer gRPC сервис
---

Runtime ML-gating обращается к Python gRPC сервису инференса.

Источники:

- `packages/ml/python/api.py`
- `proto/ml_infer.proto`
- `packages/core/src/utils/mlGrpc.ts`
- `docker-compose.infer.yml`

## Запуск / остановка

```bash
yarn ml-infer-build
yarn ml-infer-up
yarn ml-infer-down
```

Адрес по умолчанию:

- `127.0.0.1:50051`

Адрес для runtime:

```env
ML_GRPC_ADDRESS=127.0.0.1:50051
```

## RPC контракт

`PredictRequest`:

- `strategy` (string)
- `features` (`map<string,double>`)
- `threshold` (double)

`PredictResponse`:

- `probability`
- `threshold`
- `passed`

## Загрузка моделей

Сервис ищет модели в `MODEL_DIR`:

- ensemble aliases: `<Strategy>.modelN.joblib`
- single alias: `<Strategy>.joblib`

Если найдены ensemble-файлы, вероятность усредняется по всем участникам.

## Интеграция в runtime

На стороне runtime, `fetchMlThreshold`:

1. Строит ML payload из сигнала.
2. Применяет тот же trim policy, что и train (`trimMlTrainingRowWindows(..., 5)`).
3. Удаляет non-feature поля.
4. Вызывает gRPC `Predict`.

Если сервис недоступен, runtime пишет ошибку в лог и возвращает `null` для ML-решения.

## Проверка доступности

```bash
yarn doctor --require-ml
```
