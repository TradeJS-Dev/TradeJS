import argparse
import json
from typing import Any

import joblib
import numpy as np
import pandas as pd

from ml.features import expand_features, drop_raw_columns


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
    df = expand_features(df)

    df = drop_raw_columns(df)
    X = df.drop(columns=[c for c in ['label', 'signalId'] if c in df.columns])

    model_path = args.model or f'data/ml/models/{args.strategy}.joblib'
    model = joblib.load(model_path)
    prob = model.predict_proba(X)[:, 1]

    with open(args.out, 'w', encoding='utf-8') as f:
        for idx, p in enumerate(prob):
            row = df.iloc[idx].to_dict()
            row['probability'] = float(p)
            f.write(json.dumps(row) + '\n')

    print('Predictions saved:', args.out)


if __name__ == '__main__':
    main()
