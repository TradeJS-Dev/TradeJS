import glob
import os
import sys
from concurrent import futures
from typing import Any, Dict, List

import grpc
import joblib
import numpy as np
import pandas as pd


MODEL_DIR = os.getenv("MODEL_DIR", "/app/data/ml/models")
DEFAULT_STRATEGY = os.getenv("DEFAULT_STRATEGY", "default")
DEFAULT_THRESHOLD = float(os.getenv("ML_THRESHOLD", "0.5"))
GRPC_HOST = os.getenv("ML_GRPC_HOST", "0.0.0.0")
GRPC_PORT = int(os.getenv("ML_GRPC_PORT", "50051"))
PROTO_PATH = os.getenv("ML_GRPC_PROTO", "/app/proto/ml_infer.proto")

_model_cache: Dict[str, Any] = {}


def _ensure_proto() -> None:
    if os.path.exists(os.path.join(os.path.dirname(__file__), "proto", "ml_infer_pb2.py")):
        return

    try:
        from grpc_tools import protoc  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("grpcio-tools is required to generate proto stubs") from exc

    out_dir = os.path.join(os.path.dirname(__file__), "proto")
    os.makedirs(out_dir, exist_ok=True)
    proto_dir = os.path.dirname(PROTO_PATH)
    if not os.path.exists(PROTO_PATH):
        raise FileNotFoundError(PROTO_PATH)

    args = [
        "protoc",
        f"-I{proto_dir}",
        f"--python_out={out_dir}",
        f"--grpc_python_out={out_dir}",
        PROTO_PATH,
    ]
    if protoc.main(args) != 0:
        raise RuntimeError("Failed to generate gRPC stubs")


def _load_models(strategy: str) -> List[Any]:
    cached = _model_cache.get(strategy)
    if cached is not None:
        return cached

    pattern = os.path.join(MODEL_DIR, f"{strategy}.model*.joblib")
    model_paths = sorted(glob.glob(pattern))
    if model_paths:
        models = [joblib.load(path) for path in model_paths]
        _model_cache[strategy] = models
        return models

    model_path = os.path.join(MODEL_DIR, f"{strategy}.joblib")
    if not os.path.exists(model_path):
        raise FileNotFoundError(model_path)

    model = joblib.load(model_path)
    _model_cache[strategy] = [model]
    return [model]


def _align_features(X: pd.DataFrame, expected: List[str]) -> pd.DataFrame:
    if not expected:
        return X
    missing = [c for c in expected if c not in X.columns]
    for col in missing:
        X[col] = 0
    extra = [c for c in X.columns if c not in expected]
    if extra:
        X = X.drop(columns=extra)
    return X[expected]


def _predict_proba(models: List[Any], features: Dict[str, float]) -> float:
    df = pd.DataFrame([features])
    probs = []
    for model in models:
        preprocess = model.named_steps.get("preprocess")
        expected = list(getattr(preprocess, "feature_names_in_", [])) if preprocess is not None else []
        X = _align_features(df.copy(), expected)
        prob = float(model.predict_proba(X)[:, 1][0])
        probs.append(prob)
    return float(np.mean(probs)) if probs else 0.0


def serve() -> None:
    _ensure_proto()
    sys.path.append(os.path.join(os.path.dirname(__file__), "proto"))
    from ml_infer_pb2 import PredictResponse  # type: ignore
    import ml_infer_pb2_grpc  # type: ignore

    class MlInferService(ml_infer_pb2_grpc.MlInferServicer):
        def Predict(self, request, context):  # noqa: N802
            strategy = request.strategy or DEFAULT_STRATEGY
            threshold = request.threshold or DEFAULT_THRESHOLD
            features = dict(request.features)

            try:
                models = _load_models(strategy)
            except FileNotFoundError:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details(f"Model not found: {strategy}")
                return PredictResponse(probability=0.0, threshold=threshold, passed=False)

            prob = _predict_proba(models, features)
            passed = prob >= threshold
            return PredictResponse(probability=prob, threshold=threshold, passed=passed)

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    ml_infer_pb2_grpc.add_MlInferServicer_to_server(MlInferService(), server)
    server.add_insecure_port(f"{GRPC_HOST}:{GRPC_PORT}")
    server.start()
    print(f"gRPC server started on {GRPC_HOST}:{GRPC_PORT}")
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
