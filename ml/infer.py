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
    model_paths = sorted(glob.glob(f'{base}.model*.joblib'))
    if model_paths:
        models = [joblib.load(p) for p in model_paths]
    else:
        model_path = args.model or f'data/ml/models/{args.strategy}.joblib'
        models = [joblib.load(model_path)]

    probs: list[float] = []
    for idx in range(len(X)):
        row = X.iloc[[idx]].copy()
        model_probs = []
        for model in models:
            preprocess = model.named_steps.get('preprocess')
            expected = (
                list(getattr(preprocess, 'feature_names_in_', []))
                if preprocess is not None
                else []
            )
            X_row = row.reindex(columns=expected, fill_value=0) if expected else row.copy()
            model_probs.append(float(model.predict_proba(X_row)[:, 1][0]))
        probs.append(float(np.mean(model_probs)))
    prob = np.array(probs, dtype=float)

    with open(args.out, 'w', encoding='utf-8') as f:
        for idx, p in enumerate(prob):
            row = df.iloc[idx].to_dict()
            row['probability'] = float(p)
            f.write(json.dumps(row) + '\n')

    print('Predictions saved:', args.out)


if __name__ == '__main__':
    main()
