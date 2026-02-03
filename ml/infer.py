import argparse
import json
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
