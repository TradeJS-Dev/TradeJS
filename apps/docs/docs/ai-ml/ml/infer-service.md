---
title: ML Infer gRPC Service
---

Runtime ML gating calls a Python gRPC inference service.

Public interface:

- `@tradejs/core`
- gRPC `Predict` contract (`PredictRequest` / `PredictResponse`)

## Start / Stop

Start and stop the inference service with your deployment tooling
(Docker/Kubernetes/systemd/etc).

Default endpoint:

- `127.0.0.1:50051`

Set runtime address:

```env
ML_GRPC_ADDRESS=127.0.0.1:50051
```

## RPC Contract

`PredictRequest`:

- `strategy` (string)
- `features` (`map<string,double>`)
- `threshold` (double)

`PredictResponse`:

- `probability`
- `threshold`
- `passed`

## Model Loading

Service resolves model files from `MODEL_DIR`:

- ensemble aliases: `<Strategy>.modelN.joblib`
- single alias: `<Strategy>.joblib`

If ensemble files exist, prediction is mean probability across members.

## Runtime Integration

On runtime side, ML gating:

1. Builds ML payload from signal.
2. Applies same window trim policy as train (`trimMlTrainingRowWindows(..., 5)`).
3. Removes non-feature columns.
4. Calls gRPC `Predict`.

If service is unavailable, runtime logs error and returns `null` for ML decision.

## Health Check

```bash
npx @tradejs/cli doctor --require-ml
```
