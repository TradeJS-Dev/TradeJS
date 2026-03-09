---
title: ML infer gRPC сервис
---

Runtime ML-gating обращается к Python gRPC сервису инференса.

Внешний интерфейс:

- `@tradejs/core`
- gRPC контракт `Predict` (`PredictRequest` / `PredictResponse`)

## Запуск / остановка

Запускайте и останавливайте inference-сервис вашим deployment-инструментом
(Docker/Kubernetes/systemd и т.д.).

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

На стороне runtime, ML-gating:

1. Строит ML payload из сигнала.
2. Применяет тот же trim policy, что и train (`trimMlTrainingRowWindows(..., 5)`).
3. Удаляет non-feature поля.
4. Вызывает gRPC `Predict`.

Если сервис недоступен, runtime пишет ошибку в лог и возвращает `null` для ML-решения.

## Проверка доступности

```bash
npx @tradejs/cli doctor --require-ml
```
