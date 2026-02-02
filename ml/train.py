import argparse
import json
import os
from typing import Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.ensemble import RandomForestClassifier


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


def prepare_features(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
    df = df.copy()

    df['label'] = df['label'].astype('Int64')
    df = df[df['label'].notna()]

    y = df['label'].astype(int)
    X = df.drop(columns=[c for c in ['label', 'signalId'] if c in df.columns])

    return X, y


def build_pipeline(X: pd.DataFrame) -> Pipeline:
    categorical = [
        c
        for c in X.columns
        if X[c].dtype == 'object' and c not in ('strategyConfig',)
    ]
    numeric = [c for c in X.columns if c not in categorical]

    preprocessor = ColumnTransformer(
        transformers=[
            ('cat', OneHotEncoder(handle_unknown='ignore'), categorical),
            ('num', 'passthrough', numeric),
        ],
    )

    model = RandomForestClassifier(
        n_estimators=300,
        random_state=42,
        class_weight='balanced_subsample',
    )

    return Pipeline(
        steps=[
            ('preprocess', preprocessor),
            ('model', model),
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Path to CSV or JSONL')
    parser.add_argument('--strategy', default='default')
    parser.add_argument('--model', default='')
    parser.add_argument('--test-size', type=float, default=0.2)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()

    df = load_dataset(args.input)
    X, y = prepare_features(df)

    if X.empty:
        raise SystemExit('No training rows found. Check labels or input file.')

    total = len(y)
    pos = int((y == 1).sum())
    neg = int((y == 0).sum())
    pos_rate = pos / total if total else 0.0

    if total < 500:
        print(f"Warning: very small dataset ({total}). Expect unstable model.")
    elif total < 1000:
        print(f"Warning: small dataset ({total}). Results may be noisy.")

    if pos == 0 or neg == 0:
        raise SystemExit("Only one class present. Need both positive and negative outcomes.")

    if pos_rate < 0.2 or pos_rate > 0.8:
        print(
            f"Warning: class imbalance (pos_rate={pos_rate:.2%}). Consider more data or balancing."
        )

    # Avoid identical feature rows leaking across train/test.
    groups = pd.util.hash_pandas_object(X, index=False)
    unique_groups = groups.unique()
    rng = np.random.RandomState(args.seed)
    rng.shuffle(unique_groups)
    test_group_count = int(len(unique_groups) * args.test_size)
    if test_group_count <= 0 or test_group_count >= len(unique_groups):
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=args.test_size,
            random_state=args.seed,
            stratify=y,
        )
    else:
        test_groups = set(unique_groups[:test_group_count])
        test_mask = groups.isin(test_groups)
        X_train, X_test = X[~test_mask], X[test_mask]
        y_train, y_test = y[~test_mask], y[test_mask]

    pipeline = build_pipeline(X)
    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)
    y_prob = pipeline.predict_proba(X_test)[:, 1]

    print(classification_report(y_test, y_pred, digits=3))
    try:
        print('ROC AUC:', roc_auc_score(y_test, y_prob))
    except ValueError:
        print('ROC AUC: n/a')

    model_path = args.model or f'data/ml/models/{args.strategy}.joblib'
    os.makedirs(os.path.dirname(model_path), exist_ok=True)
    joblib.dump(pipeline, model_path)
    print('Model saved:', model_path)


if __name__ == '__main__':
    main()
