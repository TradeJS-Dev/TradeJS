import os
from typing import Any, Dict

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException

from ml.features import expand_features, drop_raw_columns

app = FastAPI(title="ML Inference Service")

MODEL_DIR = os.getenv("MODEL_DIR", "/app/data/ml/models")
DEFAULT_STRATEGY = os.getenv("DEFAULT_STRATEGY", "default")

_model_cache: Dict[str, Any] = {}


def load_model(strategy: str):
    model = _model_cache.get(strategy)
    if model is not None:
        return model

    model_path = os.path.join(MODEL_DIR, f"{strategy}.joblib")
    if not os.path.exists(model_path):
        raise FileNotFoundError(model_path)

    model = joblib.load(model_path)
    _model_cache[strategy] = model
    return model


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict(payload: Dict[str, Any]):
    strategy = payload.get("strategy") or payload.get("strategyName") or DEFAULT_STRATEGY

    try:
        model = load_model(strategy)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Model not found: {strategy}")

    df = pd.DataFrame([payload])
    df = expand_features(df)
    df = drop_raw_columns(df)
    X = df.drop(columns=[c for c in ["label", "signalId"] if c in df.columns])

    try:
        prob = float(model.predict_proba(X)[:, 1][0])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc))

    return {
        "strategy": strategy,
        "probability": prob,
    }
