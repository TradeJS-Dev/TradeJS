import argparse
import glob
import json
import os
from typing import Any

import joblib
import numpy as np
import pandas as pd


def load_dataset(path: str) -> pd.DataFrame:
    if path.endswith('.jsonl'):
        rows = []
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rows.append(json.loads(line))
        return pd.DataFrame(rows)

    if path.endswith('.csv'):
        return pd.read_csv(path)

    raise ValueError('Unsupported input format. Use .csv or .jsonl')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Path to CSV or JSONL')
    parser.add_argument('--strategy', default='default')
    parser.add_argument('--model', default='')
    parser.add_argument('--out', default='data/ml/predictions.jsonl')
    args = parser.parse_args()

    df = load_dataset(args.input)
    X = df.drop(columns=[c for c in ['label', 'signalId', 'profit', 'entryTimestamp'] if c in df.columns])

    base = args.model[:-7] if args.model.endswith('.joblib') else (args.model or f'data/ml/models/{args.strategy}')
    long_paths = sorted(glob.glob(f'{base}.long.model*.joblib'))
    short_paths = sorted(glob.glob(f'{base}.short.model*.joblib'))
    long_single = f'{base}.long.joblib'
    short_single = f'{base}.short.joblib'

    directional = bool(long_paths or short_paths or os.path.exists(long_single) or os.path.exists(short_single))
    if directional:
        long_models = [joblib.load(p) for p in long_paths] if long_paths else [joblib.load(long_single)]
        short_models = [joblib.load(p) for p in short_paths] if short_paths else [joblib.load(short_single)]
        probs: list[float] = []
        for idx in range(len(X)):
            row = X.iloc[[idx]].copy()
            direction = float(row.get('direction', pd.Series([1.0])).iloc[0])
            models = long_models if direction >= 0.5 else short_models
            model_probs = []
            for model in models:
                preprocess = model.named_steps.get('preprocess')
                expected = (
                    list(getattr(preprocess, 'feature_names_in_', []))
                    if preprocess is not None
                    else []
                )
                X_row = row.copy()
                if expected:
                    missing = [c for c in expected if c not in X_row.columns]
                    for col in missing:
                        X_row[col] = 0
                    extra = [c for c in X_row.columns if c not in expected]
                    if extra:
                        X_row = X_row.drop(columns=extra)
                    X_row = X_row[expected]
                model_probs.append(float(model.predict_proba(X_row)[:, 1][0]))
            probs.append(float(np.mean(model_probs)))
        prob = np.array(probs, dtype=float)
    else:
        model_path = args.model or f'data/ml/models/{args.strategy}.joblib'
        model = joblib.load(model_path)
        preprocess = model.named_steps.get('preprocess')
        expected = list(getattr(preprocess, 'feature_names_in_', [])) if preprocess is not None else []
        if expected:
            missing = [c for c in expected if c not in X.columns]
            for col in missing:
                X[col] = 0
            extra = [c for c in X.columns if c not in expected]
            if extra:
                X = X.drop(columns=extra)
            X = X[expected]
        prob = model.predict_proba(X)[:, 1]

    with open(args.out, 'w', encoding='utf-8') as f:
        for idx, p in enumerate(prob):
            row = df.iloc[idx].to_dict()
            row['probability'] = float(p)
            f.write(json.dumps(row) + '\n')

    print('Predictions saved:', args.out)


if __name__ == '__main__':
    main()
