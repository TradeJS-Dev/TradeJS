---
title: ML Infer gRPC Service
---

Runtime ML gating calls a Python gRPC inference service.

Sources:

- `packages/ml/python/api.py`
- `proto/ml_infer.proto`
- `packages/core/src/utils/mlGrpc.ts`
- `docker-compose.infer.yml`

## Start / Stop

```bash
yarn ml-infer-build
yarn ml-infer-up
yarn ml-infer-down
```

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

On runtime side, `fetchMlThreshold`:

1. Builds ML payload from signal.
2. Applies same window trim policy as train (`trimMlTrainingRowWindows(..., 5)`).
3. Removes non-feature columns.
4. Calls gRPC `Predict`.

If service is unavailable, runtime logs error and returns `null` for ML decision.

## Health Check

```bash
yarn doctor --require-ml
```
