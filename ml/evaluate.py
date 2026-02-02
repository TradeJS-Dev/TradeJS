import argparse
import json

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, roc_auc_score


def load_dataset(path: str) -> pd.DataFrame:
    if path.endswith(".jsonl"):
        rows = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rows.append(json.loads(line))
        return pd.DataFrame(rows)

    if path.endswith(".csv"):
        return pd.read_csv(path)

    raise ValueError("Unsupported input format. Use .csv or .jsonl")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to CSV or JSONL")
    parser.add_argument("--strategy", default="default")
    parser.add_argument("--model", default="")
    args = parser.parse_args()

    df = load_dataset(args.input)
    if "label" not in df.columns:
        raise SystemExit("No label column found in input file.")

    df["label"] = df["label"].astype("Int64")
    df = df[df["label"].notna()]

    y = df["label"].astype(int)
    X = df.drop(columns=[c for c in ["label", "signalId"] if c in df.columns])

    if X.empty:
        raise SystemExit("No rows to evaluate.")

    model_path = args.model or f"data/ml/models/{args.strategy}.joblib"
    model = joblib.load(model_path)

    y_pred = model.predict(X)
    y_prob = model.predict_proba(X)[:, 1]

    print(classification_report(y, y_pred, digits=3))
    try:
        print("ROC AUC:", roc_auc_score(y, y_prob))
    except ValueError:
        print("ROC AUC: n/a")


if __name__ == "__main__":
    main()
